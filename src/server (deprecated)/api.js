import "dotenv/config";
import express from "express";
import cors from "cors";
import { Readable } from "node:stream";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { Agente, AgenteStream } from "../Agente/agente.js";
import { conectarDB } from "../db/mongo.js";

const app = express();

// Cliente de ElevenLabs usado por los endpoints de audio y token temporal.
const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

// Cache local de la conexión a la base para reutilizarla entre requests.
let db;

// Configuracion general del servidor y limites del body.
app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use("/api/tts", express.text({ type: "*/*", limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));

// Reutiliza una sola conexion a Mongo para todas las peticiones.
async function getDB() {
  db ??= await conectarDB();
  return db;
}

// Normaliza el tipo de usuario para usarlo como identificador simple.
function getUserId(tipoUsuario) {
  return String(tipoUsuario || "free");
}

// Comprueba que el mensaje exista y no sea demasiado largo.
function esMensajeValido(mensaje) {
  return typeof mensaje === "string" && mensaje.trim().length >= 1 && mensaje.trim().length <= 2000;
}

// Lee la conversación guardada o crea una vacía si todavía no existe.
async function getConversacion(tipoUsuario) {
  const database = await getDB();
  const userId = getUserId(tipoUsuario);
  const guardada = await database.collection("conversaciones").findOne({ userId });

  return {
    database,
    userId,
    mensajes: guardada?.mensajes || [],
  };
}

// Guarda solo los últimos mensajes para que la conversación no crezca sin límite.
async function saveConversacion(database, userId, mensajes) {
  const mensajesGuardados = mensajes.slice(-20);

  await database.collection("conversaciones").updateOne(
    { userId },
    {
      $set: {
        userId,
        mensajes: mensajesGuardados,
        ultimaActualizacion: new Date(),
        totalMensajes: mensajesGuardados.length,
      },
    },
    { upsert: true }
  );

  return mensajesGuardados;
}

// Agrega un mensaje con el formato compartido por la API y el agente.
function addMensaje(mensajes, role, content) {
  mensajes.push({ role, content, timestamp: new Date() });
}

// Prepara el contexto común que usan /chat y /chat/stream.
async function prepararChat(mensaje, tipoUsuario = "free") {
  if (!esMensajeValido(mensaje)) {
    return { error: "Mensaje invalido (1-2000 caracteres)" };
  }

  const texto = mensaje.trim();
  const conversacion = await getConversacion(tipoUsuario);
  const esPrimerMensaje = conversacion.mensajes.length === 0;

  addMensaje(conversacion.mensajes, "user", texto);

  return { texto, tipoUsuario, esPrimerMensaje, ...conversacion };
}

// Envía eventos SSE al cliente para el chat en streaming.
function sendSSE(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// Permite recibir texto plano o JSON en el endpoint de TTS.
function parseTtsBody(body) {
  if (!body || typeof body === "object") return body || {};
  if (typeof body !== "string") return {};

  const texto = body.trim();
  if (!texto) return {};

  if (!texto.startsWith("{")) return { text: texto };

  try {
    return JSON.parse(texto);
  } catch {
    return { text: texto };
  }
}

// Endpoint de salud: comprueba que Express responde y que Mongo está disponible.
app.get("/", async (req, res) => {
  try {
    await getDB();
    res.json({ status: "OK", mongo: true, message: "PAILAPP API corriendo" });
  } catch (err) {
    console.error("Mongo error:", err.message);
    res.status(503).json({ status: "API OK", mongo: false, message: "MongoDB no disponible" });
  }
});

// Respuesta tradicional: espera la generación completa y responde JSON.
app.post("/api/chat", async (req, res) => {
  try {
    const { mensaje, tipoUsuario = "free" } = req.body || {};
    const chat = await prepararChat(mensaje, tipoUsuario);

    if (chat.error) {
      return res.status(400).json({ error: chat.error });
    }

    const respuesta = await Agente(chat.texto, chat.tipoUsuario, chat.mensajes, chat.esPrimerMensaje);
    addMensaje(chat.mensajes, "assistant", respuesta);

    const mensajesGuardados = await saveConversacion(chat.database, chat.userId, chat.mensajes);

    res.json({
      respuesta,
      tipoUsuario: chat.tipoUsuario,
      esPrimerMensaje: chat.esPrimerMensaje,
      totalMensajes: mensajesGuardados.length,
    });
  } catch (err) {
    console.error("Chat endpoint error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Streaming por SSE: envía fragmentos mientras Gemini sigue generando texto.
app.post("/api/chat/stream", async (req, res) => {
  // Estas cabeceras dejan la conexion abierta para enviar texto por partes.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  try {
    const { mensaje, tipoUsuario = "free" } = req.body || {};
    const chat = await prepararChat(mensaje, tipoUsuario);

    if (chat.error) {
      sendSSE(res, "error", { error: chat.error });
      return res.end();
    }

    let respuesta = "";
    sendSSE(res, "meta", { esPrimerMensaje: chat.esPrimerMensaje });

    // Se reenvía cada delta listo para pintarse en la interfaz del cliente.
    for await (const delta of AgenteStream(chat.texto, chat.tipoUsuario, chat.mensajes, chat.esPrimerMensaje)) {
      if (!delta) continue;
      respuesta += delta;
      sendSSE(res, "chunk", { delta });
    }

    if (!respuesta.trim()) {
      throw new Error("El agente no devolvio contenido");
    }

    addMensaje(chat.mensajes, "assistant", respuesta);
    const mensajesGuardados = await saveConversacion(chat.database, chat.userId, chat.mensajes);

    sendSSE(res, "done", {
      respuesta,
      tipoUsuario: chat.tipoUsuario,
      esPrimerMensaje: chat.esPrimerMensaje,
      totalMensajes: mensajesGuardados.length,
    });
    res.end();
  } catch (err) {
    console.error("Chat stream error:", err);
    sendSSE(res, "error", { error: "Error interno del servidor" });
    res.end();
  }
});

// Convierte texto a audio MP3 y lo devuelve en base64.
app.post("/api/tts", async (req, res) => {
  try {
    const { text, voiceId = "pNInz6obpgDQGcFmaJgB" } = parseTtsBody(req.body);

    // Valida el texto antes de pedir audio a ElevenLabs.
    if (typeof text !== "string" || !text.trim() || text.length > 5000) {
      return res.status(400).json({ error: "Texto invalido" });
    }

    if (!process.env.ELEVENLABS_API_KEY2) {
      return res.status(500).json({ error: "Falta ELEVENLABS_API_KEY" });
    }

    const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
      text: text.trim(),
      modelId: "eleven_turbo_v2_5",
      outputFormat: "mp3_44100_128",
    });

    // Convierte el stream web a Buffer para devolverlo como base64.
    const chunks = [];
    for await (const chunk of Readable.fromWeb(audioStream)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.json({
      audioBase64: Buffer.concat(chunks).toString("base64"),
      mimeType: "audio/mpeg",
      voiceId,
    });
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ error: err?.message || "Error TTS" });
  }
});

// Captura errores cuando el body llega con JSON mal formado.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      error: "JSON invalido",
      detalle: 'Envia {"text":"hola"} o texto plano en el body para /api/tts',
    });
  }

  next(err);
});

// Crea un token temporal para consumir agentes de ElevenLabs desde frontend.
app.post("/api/get-token", async (req, res) => {
  try {
    const { agentId, tipoUsuario = "free" } = req.body || {};
    if (!agentId) {
      return res.status(400).json({ error: "Falta agentId" });
    }

    // Pide un token temporal para usar un agente de ElevenLabs desde el cliente.
    const response = await fetch(`https://api.elevenlabs.io/v1/agents/${agentId}/tokens`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        permissions: ["agent:play", "agent:speak"],
        duration_seconds: 3600,
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs: ${response.status}`);
    }

    const { token } = await response.json();
    res.json({ token, agentId, tipoUsuario });
  } catch (err) {
    console.error("Token error:", err);
    res.status(500).json({ error: "Error token" });
  }
});

// Arranque local del servidor cuando no se despliega en Vercel.
function startServer() {
  const PORT = process.env.PORT || 4000;

  return app.listen(PORT, () => {
    console.log(`PAILAPP API en http://localhost:${PORT}`);
  });
}

// Permite cerrar el proceso con Ctrl + C cuando se ejecuta localmente.
if (process.env.VERCEL !== "1") {
  process.on("SIGINT", () => {
    console.log("\nCerrando servidor...");
    process.exit(0);
  });

  startServer();
}

export { app, startServer };
export default app;

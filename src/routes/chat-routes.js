import { Router } from "express";
import { Agente, AgenteStream } from "../Agente/agente.js";
import { AgenteGroq, AgenteGroqStream } from "../Agente/agenteGroq.js";
import { AgenteOR, AgenteORStream } from "../Agente/agenteOpenRouter.js";
import {
  prepararChat,
  addMensaje,
  saveConversacion,
  sendSSE,
} from "../utils/chat-helpers.js";
import { necesitaBusqueda, webSearch } from "../services/webSearchService.js";
import {
  GetoCreateConvId,
  getPerfilUsuario,
  normalizarIdUsuario,
} from "../services/ConSer.js";

const router = Router();

const esLimiteConversaciones = (err) =>
  err?.message?.toLowerCase().includes("conversaciones activas");

async function getPerfilUsuarioSeguro(idUsuario) {
  try {
    return await getPerfilUsuario(idUsuario);
  } catch (err) {
    console.warn("No se pudo cargar el perfil del usuario desde MySQL:", err.message);
    return null;
  }
}

function insertarContextoWeb(mensajes, contextoWeb) {
  if (!contextoWeb) return mensajes;

  const mensajeActual = mensajes[mensajes.length - 1];
  const historialPrevio = mensajes.slice(0, -1);

  return [
    ...historialPrevio,
    { role: "system", content: `[CONTEXTO WEB]\n${contextoWeb}` },
    mensajeActual,
  ].filter(Boolean);
}

async function cargarHistorialConContextoWeb(mensaje, mensajes) {
  if (!necesitaBusqueda(mensaje)) return mensajes;

  try {
    const contextoWeb = await webSearch(mensaje);
    return insertarContextoWeb(mensajes, contextoWeb);
  } catch (err) {
    console.warn("Busqueda web fallida, se continua sin contexto web:", err.message);
    return mensajes;
  }
}

const PROVEEDORES_RESPUESTA = [
  { nombre: "Groq", responder: AgenteGroq },
  { nombre: "OpenRouter", responder: AgenteOR },
  { nombre: "Gemini", responder: Agente },
];

const PROVEEDORES_STREAM = [
  { nombre: "Groq", responder: AgenteGroqStream },
  { nombre: "OpenRouter", responder: AgenteORStream },
  { nombre: "Gemini", responder: AgenteStream },
];

async function responderConFallback({
  mensaje,
  tipoUsuario,
  historial,
  esPrimeraCharla,
  perfilUsuario,
}) {
  let lastError = null;

  for (const proveedor of PROVEEDORES_RESPUESTA) {
    try {
      return await proveedor.responder(
        mensaje,
        tipoUsuario,
        historial,
        esPrimeraCharla,
        perfilUsuario,
      );
    } catch (err) {
      lastError = err;
      console.warn(`[${proveedor.nombre} fallido]`, err.message);
    }
  }

  throw lastError || new Error("No hay proveedores disponibles");
}

async function iniciarStreamConFallback({
  mensaje,
  tipoUsuario,
  historial,
  esPrimeraCharla,
  perfilUsuario,
}) {
  let lastError = null;

  for (const proveedor of PROVEEDORES_STREAM) {
    try {
      const iterator = proveedor.responder(
        mensaje,
        tipoUsuario,
        historial,
        esPrimeraCharla,
        perfilUsuario,
      )[Symbol.asyncIterator]();
      const first = await iterator.next();

      if (first.done) {
        throw new Error(`${proveedor.nombre} no emitio contenido`);
      }

      return { proveedor: proveedor.nombre, iterator, first };
    } catch (err) {
      lastError = err;
      console.warn(`[${proveedor.nombre} stream fallido]`, err.message);
    }
  }

  throw lastError || new Error("No hay proveedores stream disponibles");
}

// POST /api/chat
router.post("/chat", async (req, res) => {
  try {
    const { mensaje, idUsuario, conversationId, nuevaConversacion } = req.body || {};

    if (!idUsuario) {
      return res.status(400).json({ error: "Falta idUsuario" });
    }

    // MYSQL: Obtener/crear conversación
    let idUsuarioNormalizado;
    let conversationIdFinal;

    try {
      idUsuarioNormalizado = normalizarIdUsuario(idUsuario);
      conversationIdFinal = await GetoCreateConvId(
        idUsuarioNormalizado,
        conversationId,
        { crearNueva: Boolean(nuevaConversacion) },
      );
    } catch (err) {
      if (esLimiteConversaciones(err)) {
        return res.status(409).json({ error: err.message });
      }

      console.error("Error MYSQL conversacion: ", err);
      return res
        .status(500)
        .json({ error: "Error al gestionar la conversacion" });
    }

    const meta = { conversationId: conversationIdFinal, idUsuario: idUsuarioNormalizado };
    const perfilUsuario = await getPerfilUsuarioSeguro(idUsuarioNormalizado);

    // Mongo: preparar contexto para la conversación
    const chat = await prepararChat(mensaje, meta);

    if (chat.error) {
      return res.status(400).json({ error: chat.error });
    }

    const historialConContexto = await cargarHistorialConContextoWeb(
      chat.texto,
      chat.mensajes,
    );
    const respuesta = await responderConFallback({
      mensaje: chat.texto,
      tipoUsuario: "mysql-user",
      historial: historialConContexto,
      esPrimeraCharla: chat.esPrimerMensaje,
      perfilUsuario,
    });

    addMensaje(chat.mensajes, "assistant", respuesta);

    const mensajesGuardados = await saveConversacion(
      chat.database,
      chat.meta, // { conversationId, idUsuario }
      chat.mensajes
    );

    res.json({
      respuesta,
      conversationId: conversationIdFinal,
      idUsuario: idUsuarioNormalizado,
      esPrimerMensaje: chat.esPrimerMensaje,
      totalMensajes: mensajesGuardados.length,
    });
  } catch (err) {
    console.error("Chat endpoint error:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// POST /api/chat/stream
router.post("/chat/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  try {
    const { mensaje, idUsuario, conversationId, nuevaConversacion } = req.body || {};

    if (!idUsuario) {
      sendSSE(res, "error", { error: "Falta idUsuario" });
      return res.end();
    }

    // MYSQL: Obtener/crear conversación
    let idUsuarioNormalizado;
    let conversationIdFinal;

    try {
      idUsuarioNormalizado = normalizarIdUsuario(idUsuario);
      conversationIdFinal = await GetoCreateConvId(
        idUsuarioNormalizado,
        conversationId,
        { crearNueva: Boolean(nuevaConversacion) },
      );
    } catch (err) {
      if (esLimiteConversaciones(err)) {
        sendSSE(res, "error", { error: err.message });
        return res.end();
      }

      console.error("Error MYSQL conversacion: ", err);
      sendSSE(res, "error", {
        error: "Error al gestionar la conversacion",
      });
      return res.end();
    }

    const meta = { conversationId: conversationIdFinal, idUsuario: idUsuarioNormalizado };
    const perfilUsuario = await getPerfilUsuarioSeguro(idUsuarioNormalizado);

    const chat = await prepararChat(mensaje, meta);

    if (chat.error) {
      sendSSE(res, "error", { error: chat.error });
      return res.end();
    }

    let respuesta = "";
    sendSSE(res, "meta", {
      esPrimerMensaje: chat.esPrimerMensaje,
      conversationId: conversationIdFinal,
      idUsuario: idUsuarioNormalizado,
    });

    const historialConContexto = await cargarHistorialConContextoWeb(
      chat.texto,
      chat.mensajes,
    );
    const streamFallback = await iniciarStreamConFallback({
      mensaje: chat.texto,
      tipoUsuario: "mysql-user",
      historial: historialConContexto,
      esPrimeraCharla: chat.esPrimerMensaje,
      perfilUsuario,
    });

    const firstDelta = streamFallback.first.value;
    if (firstDelta) {
      respuesta += firstDelta;
      sendSSE(res, "chunk", { delta: firstDelta });
    }

    for await (const delta of streamFallback.iterator) {
      if (!delta) continue;
      respuesta += delta;
      sendSSE(res, "chunk", { delta });
    }

    if (!respuesta.trim()) {
      throw new Error("El agente no devolvio contenido");
    }

    addMensaje(chat.mensajes, "assistant", respuesta);

    const mensajesGuardados = await saveConversacion(
      chat.database,
      chat.meta,
      chat.mensajes
    );

    sendSSE(res, "done", {
      respuesta,
      conversationId: conversationIdFinal,
      idUsuario: idUsuarioNormalizado,
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

export default router;

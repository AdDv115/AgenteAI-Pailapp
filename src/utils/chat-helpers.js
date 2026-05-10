import { conectarDB } from "../db/mongo.js";

let db;

// conexión única a Mongo
export async function getDB() {
  db ??= await conectarDB();
  return db;
}

export function esMensajeValido(mensaje) {
  return (
    typeof mensaje === "string" &&
    mensaje.trim().length >= 1 &&
    mensaje.trim().length <= 2000
  );
}

export function addMensaje(mensajes, role, content) {
  mensajes.push({ role, content, timestamp: new Date() });
}

// meta = { conversationId, idUsuario }
export async function getConversacion(meta) {
  const { conversationId, idUsuario } = meta;
  const database = await getDB();

  const guardada = await database.collection("conversaciones")
  .findOne({ conversationId, idUsuario, });

  return {
    database,
    meta, 
    mensajes: guardada?.mensajes || [],
  };
}

export async function saveConversacion(database, meta, mensajes) {
  const mensajesGuardados = mensajes.slice(-20);

  await database.collection("conversaciones").updateOne(
    { conversationId: meta.conversationId, idUsuario: meta.idUsuario },
    {
      $set: {
        ...meta,
        mensajes: mensajesGuardados,
        ultimaActualizacion: new Date(),
        totalMensajes: mensajesGuardados.length,
      },
    },
    { upsert: true }
  );

  return mensajesGuardados;
}

export async function prepararChat(mensaje, meta) {
  if (!esMensajeValido(mensaje)) {
    return { error: "Mensaje invalido (1-2000 caracteres)" };
  }

  const texto = mensaje.trim();
  const conversacion = await getConversacion(meta);
  const esPrimerMensaje = conversacion.mensajes.length === 0;

  addMensaje(conversacion.mensajes, "user", texto);

  return { texto, 
    tipoUsuario: "mysql-user", 
    esPrimerMensaje, 
    ...conversacion,
  };
}

// SSE
export function sendSSE(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// TTS
export function parseTtsBody(body) {
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
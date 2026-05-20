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

function normalizarIdNumerico(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : valor;
}

function variantesId(valor) {
  const normalizado = normalizarIdNumerico(valor);
  const variantes = [normalizado, String(normalizado)];
  return [...new Set(variantes)];
}

function normalizarMeta(meta) {
  return {
    conversationId: normalizarIdNumerico(meta.conversationId),
    idUsuario: normalizarIdNumerico(meta.idUsuario),
  };
}

// meta = { conversationId, idUsuario }
export async function getConversacion(meta) {
  const metaNormalizada = normalizarMeta(meta);
  const { conversationId, idUsuario } = metaNormalizada;
  const database = await getDB();

  const guardada = await database.collection("conversaciones")
  .findOne({
    conversationId: { $in: variantesId(conversationId) },
    idUsuario: { $in: variantesId(idUsuario) },
  });

  return {
    database,
    meta: metaNormalizada,
    mensajes: guardada?.mensajes || [],
  };
}

export async function saveConversacion(database, meta, mensajes) {
  const metaNormalizada = normalizarMeta(meta);
  const mensajesGuardados = mensajes;

  await database.collection("conversaciones").updateOne(
    {
      conversationId: { $in: variantesId(metaNormalizada.conversationId) },
      idUsuario: { $in: variantesId(metaNormalizada.idUsuario) },
    },
    {
      $setOnInsert: {
        createdAt: new Date(),
      },
      $set: {
        ...metaNormalizada,
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

  return { 
    texto, 
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

import { Readable } from "node:stream";
import { conectarDB } from "../db/mongo.js";

// cache de conexión Mongo
let db;

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

export async function getConversacion(tipoUsuario = "free") {
  const database = await getDB();
  const userId = String(tipoUsuario || "free");
  const guardada = await database
    .collection("conversaciones")
    .findOne({ userId });

  return {
    database,
    userId,
    mensajes: guardada?.mensajes || [],
  };
}

export async function saveConversacion(database, userId, mensajes) {
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

export async function prepararChat(mensaje, tipoUsuario = "free") {
  if (!esMensajeValido(mensaje)) {
    return { error: "Mensaje invalido (1-2000 caracteres)" };
  }

  const texto = mensaje.trim();
  const conversacion = await getConversacion(tipoUsuario);
  const esPrimerMensaje = conversacion.mensajes.length === 0;

  addMensaje(conversacion.mensajes, "user", texto);

  return { texto, tipoUsuario, esPrimerMensaje, ...conversacion };
}

export function sendSSE(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

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
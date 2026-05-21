import { Router } from "express";
import { Agente, AgenteStream } from "../Agente/agente.js";
import {
  prepararChat,
  addMensaje,
  saveConversacion,
  sendSSE,
} from "../utils/chat-helpers.js";
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

    const respuesta = await Agente(
      chat.texto,
      "mysql-user",
      chat.mensajes,
      chat.esPrimerMensaje,
      perfilUsuario
    );

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

    for await (const delta of AgenteStream(
      chat.texto,
      "mysql-user",
      chat.mensajes,
      chat.esPrimerMensaje,
      perfilUsuario
    )) {
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

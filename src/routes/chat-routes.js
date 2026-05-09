import { Router } from "express";
import { Agente, AgenteStream } from "../Agente/agente.js";
import {
  prepararChat,
  addMensaje,
  saveConversacion,
  sendSSE,
} from "../utils/chat-helpers.js";

const router = Router();

router.post("/chat", async (req, res) => {
  try {

    console.log("Body recibido en /api/chat:", req.body);

    const { mensaje, tipoUsuario = "free" } = req.body || {};
    const chat = await prepararChat(mensaje, tipoUsuario);

    if (chat.error) {
      return res.status(400).json({ error: chat.error });
    }

    const respuesta = await Agente(
      chat.texto,
      chat.tipoUsuario,
      chat.mensajes,
      chat.esPrimerMensaje
    );
    addMensaje(chat.mensajes, "assistant", respuesta);

    const mensajesGuardados = await saveConversacion(
      chat.database,
      chat.userId,
      chat.mensajes
    );

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

router.post("/chat/stream", async (req, res) => {
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

    for await (const delta of AgenteStream(
      chat.texto,
      chat.tipoUsuario,
      chat.mensajes,
      chat.esPrimerMensaje
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
      chat.userId,
      chat.mensajes
    );

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

export default router;
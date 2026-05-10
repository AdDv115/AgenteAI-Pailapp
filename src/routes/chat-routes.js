import { Router } from "express";
import { Agente, AgenteStream } from "../Agente/agente.js";
import {
  prepararChat,
  addMensaje,
  saveConversacion,
  sendSSE,
} from "../utils/chat-helpers.js";
import { GetoCreateConvId } from "../services/ConSer.js";

const router = Router();

router.post("/chat", async (req, res) => {
  try {

    const { mensaje, idUsuario } = req.body || {};

    if (!idUsuario){
        return res.status(400).json({ error: "Falta idUsuario" });
    }

    // MYSQL: Obtener/Crear conversacion

    let conversationId;
    
    try {
        conversationId = await GetoCreateConvId(idUsuario);
    
    }catch{
        if (err.message.includes("Limite de conversaciones")) {
            return res.status(409).json({ error: err.message });
        }

        console.error("Error MYSQL conversacion: ", err);
        return res
            .status(500)
            .json({ error: "Error al gestionar la conversacion"});
    }

    // Mongo: Preparar contexto para la conversacion
    const chat = await prepararChat(mensaje, { conversationId, idUsuario, });

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
      chat.meta, // { conversationId, idUsuario }
      chat.mensajes
    );

    res.json({
      respuesta,
      conversationId,
      idUsuario,
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
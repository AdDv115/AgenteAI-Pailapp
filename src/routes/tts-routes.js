import { Router } from "express";
import { Readable } from "node:stream";
import { parseTtsBody } from "../utils/chat-helpers.js";

const router = Router();

function getTtsSkipResponse(voiceId, reason = "tts_unavailable") {
  return {
    audioBase64: null,
    mimeType: null,
    voiceId,
    audioDisponible: false,
    audioOmitido: true,
    reason,
  };
}

function getElevenLabsStatus(error) {
  return error?.statusCode || error?.status || error?.response?.status;
}

function getElevenLabsMessage(error) {
  return String(
    error?.body?.detail?.message ||
    error?.body?.detail ||
    error?.body?.message ||
    error?.message ||
    "",
  ).toLowerCase();
}

function isElevenLabsNonBlockingError(error) {
  const status = getElevenLabsStatus(error);
  const message = getElevenLabsMessage(error);

  return (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 429 ||
    status >= 500 ||
    message.includes("quota") ||
    message.includes("credit") ||
    message.includes("limit") ||
    message.includes("token") ||
    message.includes("subscription") ||
    message.includes("insufficient")
  );
}

// POST /api/tts
router.post("/tts", async (req, res) => {
  let voiceId = "pNInz6obpgDQGcFmaJgB";

  try {
    const body = parseTtsBody(req.body);
    const text = body.text;
    voiceId = body.voiceId || voiceId;

    if (typeof text !== "string" || !text.trim() || text.length > 5000) {
      return res.status(400).json({ error: "Texto invalido" });
    }

    const elevenlabs = req.app.locals.elevenlabs;
    if (!elevenlabs) {
      return res.json(getTtsSkipResponse(voiceId, "elevenlabs_client_missing"));
    }

    if (!process.env.ELEVENLABS_API_KEY2) {
      return res.json(getTtsSkipResponse(voiceId, "elevenlabs_key_missing"));
    }

    const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
      text: text.trim(),
      modelId: "eleven_turbo_v2_5",
      outputFormat: "mp3_44100_128",
    });

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
      audioDisponible: true,
      audioOmitido: false,
    });
  } catch (err) {
    if (isElevenLabsNonBlockingError(err)) {
      console.warn("TTS omitido:", err?.message || err);
      return res.json(getTtsSkipResponse(voiceId, "elevenlabs_unavailable"));
    }

    console.warn("TTS omitido por error inesperado:", err?.message || err);
    return res.json(getTtsSkipResponse(voiceId, "tts_error"));
  }
});

export default router;

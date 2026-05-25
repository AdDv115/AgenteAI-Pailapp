import { Router } from "express";
import { Readable } from "node:stream";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
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

async function convertTextToAudio(apiKey, voiceId, text) {
  const client = new ElevenLabsClient({ apiKey });
  const audioStream = await client.textToSpeech.convert(voiceId, {
    text: text.trim(),
    modelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_44100_128",
  });

  const chunks = [];
  for await (const chunk of Readable.fromWeb(audioStream)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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

    const key1 = process.env.ELEVENLABS_API_KEY2;
    const key2 = process.env.ELEVENLABS_API_KEY;

    if (!key1 && !key2) {
      return res.json(getTtsSkipResponse(voiceId, "elevenlabs_key_missing"));
    }

    let audioBuffer = null;
    let usedKey = null;

    // Intentar con ELEVENLABS_API_KEY2 primero
    if (key1) {
      try {
        audioBuffer = await convertTextToAudio(key1, voiceId, text);
        usedKey = "KEY2";
      } catch (err) {
        if (isElevenLabsNonBlockingError(err)) {
          console.warn(`TTS: KEY2 agotada/inválida (${getElevenLabsStatus(err)}), intentando KEY1...`);
          audioBuffer = null;
        } else {
          throw err;
        }
      }
    }

    // Fallback a ELEVENLABS_API_KEY si KEY2 falló
    if (!audioBuffer && key2) {
      try {
        audioBuffer = await convertTextToAudio(key2, voiceId, text);
        usedKey = "KEY1";
      } catch (err) {
        if (isElevenLabsNonBlockingError(err)) {
          console.warn(`TTS: KEY1 también agotada/inválida (${getElevenLabsStatus(err)}). Sin audio.`);
          return res.json(getTtsSkipResponse(voiceId, "elevenlabs_both_keys_exhausted"));
        }
        throw err;
      }
    }

    if (!audioBuffer) {
      return res.json(getTtsSkipResponse(voiceId, "elevenlabs_unavailable"));
    }

    console.log(`TTS generado con ${usedKey}`);

    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.json({
      audioBase64: audioBuffer.toString("base64"),
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

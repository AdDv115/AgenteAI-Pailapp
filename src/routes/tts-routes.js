import { Router } from "express";
import { Readable } from "node:stream";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { parseTtsBody } from "../utils/chat-helpers.js";

const router = Router();

// Límite de caracteres por llamada a ElevenLabs
const TTS_MAX_CHARS = 900;

// Modelo y formato de audio: turbo para menor latencia, mp3 a menor bitrate para ahorrar cuota
const TTS_MODEL_ID = "eleven_turbo_v2_5";
const TTS_OUTPUT_FORMAT = "mp3_22050_32";

// Caracteres que no aportan al audio (markdown, emojis de bloque, URLs)
const MARKDOWN_REGEX = /```[\s\S]*?```|`[^`]+`|\*\*|__|\*|_|#{1,6}\s|\[([^\]]+)\]\([^)]+\)|https?:\/\/\S+/g;
const EMOJI_BLOCK_REGEX = /[\u{1F300}-\u{1FFFF}]/gu;

/**
 * Limpia el texto antes de enviarlo a TTS:
 * - Elimina markdown, URLs y emojis que no se pronuncian bien
 * - Colapsa espacios y saltos de línea múltiples
 */
function limpiarParaTts(text) {
  return text
    .replace(MARKDOWN_REGEX, (_, linkText) => linkText || "")
    .replace(EMOJI_BLOCK_REGEX, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Trunca en el último signo de puntuación antes del límite
 * para que el audio no quede cortado a la mitad de una frase.
 */
function truncarParaTts(text, maxChars = TTS_MAX_CHARS) {
  if (text.length <= maxChars) return text;

  const fragmento = text.slice(0, maxChars);
  const ultimoPunto = Math.max(
    fragmento.lastIndexOf(". "),
    fragmento.lastIndexOf("! "),
    fragmento.lastIndexOf("? "),
    fragmento.lastIndexOf(".\n"),
    fragmento.lastIndexOf("!\n"),
    fragmento.lastIndexOf("?\n"),
  );

  if (ultimoPunto > 100) return fragmento.slice(0, ultimoPunto + 1).trim();

  const ultimoEspacio = fragmento.lastIndexOf(" ");
  return (ultimoEspacio > 50 ? fragmento.slice(0, ultimoEspacio) : fragmento).trim();
}

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
    modelId: TTS_MODEL_ID,
    outputFormat: TTS_OUTPUT_FORMAT,
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
    const rawText = body.text;
    voiceId = body.voiceId || voiceId;

    if (typeof rawText !== "string" || !rawText.trim() || rawText.length > 5000) {
      return res.status(400).json({ error: "Texto invalido" });
    }

    // Limpiar markdown/emojis y truncar para eficiencia
    const text = truncarParaTts(limpiarParaTts(rawText));

    if (!text) {
      return res.json(getTtsSkipResponse(voiceId, "text_empty_after_clean"));
    }

    const key1 = process.env.ELEVENLABS_API_KEY2;
    const key2 = process.env.ELEVENLABS_API_KEY;

    if (!key1 && !key2) {
      return res.json(getTtsSkipResponse(voiceId, "elevenlabs_key_missing"));
    }

    let audioBuffer = null;
    let usedKey = null;

    if (key1) {
      try {
        audioBuffer = await convertTextToAudio(key1, voiceId, text);
        usedKey = "KEY2";
      } catch (err) {
        if (isElevenLabsNonBlockingError(err)) {
          console.warn(`TTS: KEY2 agotada/invalida (${getElevenLabsStatus(err)}), intentando KEY1...`);
        } else {
          throw err;
        }
      }
    }

    if (!audioBuffer && key2) {
      try {
        audioBuffer = await convertTextToAudio(key2, voiceId, text);
        usedKey = "KEY1";
      } catch (err) {
        if (isElevenLabsNonBlockingError(err)) {
          console.warn(`TTS: KEY1 tambien agotada/invalida (${getElevenLabsStatus(err)}). Sin audio.`);
          return res.json(getTtsSkipResponse(voiceId, "elevenlabs_both_keys_exhausted"));
        }
        throw err;
      }
    }

    if (!audioBuffer) {
      return res.json(getTtsSkipResponse(voiceId, "elevenlabs_unavailable"));
    }

    console.log(`TTS generado con ${usedKey}: ${text.length} chars (original: ${rawText.length})`);

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

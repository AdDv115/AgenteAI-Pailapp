import { Router } from "express";
import { Readable } from "node:stream";
import { parseTtsBody } from "../utils/chat-helpers.js";

const router = Router();

// POST /api/tts
router.post("/tts", async (req, res) => {
  try {
    const { text, voiceId = "pNInz6obpgDQGcFmaJgB" } = parseTtsBody(req.body);

    if (typeof text !== "string" || !text.trim() || text.length > 5000) {
      return res.status(400).json({ error: "Texto invalido" });
    }

    const elevenlabs = req.app.locals.elevenlabs;
    if (!elevenlabs) {
      return res.status(500).json({ error: "Cliente ElevenLabs no inicializado" });
    }

    if (!process.env.ELEVENLABS_API_KEY2) {
      return res.status(500).json({ error: "Falta ELEVENLABS_API_KEY" });
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
    });
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ error: err?.message || "Error TTS" });
  }
});

export default router;
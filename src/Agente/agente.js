import { ai } from "../config/gemini.js";
import { buildPrompt, extractRespuesta } from "./promptBuilder.js";

// Modelos candidatos para mantener compatibilidad entre entornos y versiones.
const MODELOS_FALLBACK = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

// Reintentos basicos para errores temporales del proveedor.
const MAX_RETRIES_PER_MODEL = 2;
const RETRY_BASE_MS = 350;

function isModelNotSupportedError(error) {
  const status = error?.status;
  const message = String(error?.message || "").toLowerCase();
  return (
    status === 404 ||
    message.includes("not found") ||
    message.includes("not supported for generatecontent")
  );
}

function isTransientModelError(error) {
  const status = error?.status;
  const message = String(error?.message || "").toLowerCase();
  return (
    status === 429 ||
    status === 500 ||
    status === 503 ||
    message.includes("high demand") ||
    message.includes("unavailable") ||
    message.includes("resource exhausted")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithFallback(prompt) {
  let lastError = null;
  for (const model of MODELOS_FALLBACK) {
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
        return { response, model };
      } catch (error) {
        lastError = error;

        if (isModelNotSupportedError(error)) {
          console.warn(`Modelo no disponible para generateContent: ${model}`);
          break;
        }

        if (isTransientModelError(error) && attempt < MAX_RETRIES_PER_MODEL) {
          const waitMs = RETRY_BASE_MS * (attempt + 1);
          console.warn(
            `Gemini transient error (${model}) intento ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1}. Reintentando en ${waitMs}ms`,
          );
          await sleep(waitMs);
          continue;
        }

        throw error;
      }
    }
  }

  throw lastError || new Error("No hay modelos compatibles disponibles");
}

async function generateStreamWithFallback(prompt) {
  let lastError = null;
  for (const model of MODELOS_FALLBACK) {
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
      try {
        const stream = await ai.models.generateContentStream({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
        return { stream, model };
      } catch (error) {
        lastError = error;

        if (isModelNotSupportedError(error)) {
          console.warn(`Modelo no disponible para generateContentStream: ${model}`);
          break;
        }

        if (isTransientModelError(error) && attempt < MAX_RETRIES_PER_MODEL) {
          const waitMs = RETRY_BASE_MS * (attempt + 1);
          console.warn(
            `Gemini transient stream error (${model}) intento ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1}. Reintentando en ${waitMs}ms`,
          );
          await sleep(waitMs);
          continue;
        }

        throw error;
      }
    }
  }

  throw lastError || new Error("No hay modelos compatibles disponibles para stream");
}

export async function Agente(
  mensajeUser,
  tipoUsuario = "free",
  historial = [],
  esPrimeraCharla = false,
  perfilUsuario = null,
) {
  const prompt = buildPrompt(
    mensajeUser,
    tipoUsuario,
    historial,
    esPrimeraCharla,
    perfilUsuario,
  );

  const { response: respuesta } = await generateWithFallback(prompt);
  const candidate = respuesta.candidates?.[0];
  if (!candidate) {
    throw new Error("No se recibio ninguna candidate de Gemini");
  }

  const parts = candidate.content?.parts || [];
  const texto = parts
    .map((part) => part.text || "")
    .join(" ")
    .trim();

  return extractRespuesta(texto);
}

export async function* AgenteStream(
  mensajeUser,
  tipoUsuario = "free",
  historial = [],
  esPrimeraCharla = false,
  perfilUsuario = null,
) {
  const prompt = buildPrompt(
    mensajeUser,
    tipoUsuario,
    historial,
    esPrimeraCharla,
    perfilUsuario,
  );
  const { stream } = await generateStreamWithFallback(prompt);

  let raw = "";
  let emitted = 0;

  for await (const chunk of stream) {
    const deltaRaw = chunk?.text || "";
    if (!deltaRaw) continue;

    raw += deltaRaw;
    const textoActual = extractRespuesta(raw);
    const delta = textoActual.slice(emitted);

    if (delta) {
      emitted += delta.length;
      yield delta;
    }
  }

  const finalText = extractRespuesta(raw);
  if (!finalText) {
    throw new Error("No se recibio texto de respuesta del agente");
  }

  if (emitted < finalText.length) {
    yield finalText.slice(emitted);
  }
}

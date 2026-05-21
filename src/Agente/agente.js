import { ai } from "../config/gemini.js";
import { pSistema } from "../prompts/pSistema.js";
import { pLogica } from "../prompts/pLogica.js";
import { pRules } from "../prompts/pRules.js";

// Modelos candidatos para mantener compatibilidad entre entornos y versiones.
const MODELOS_FALLBACK = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

// El modelo debe escribir la respuesta visible después de este marcador.
const RESPUESTA_MARKER = "RESPUESTA:";

// Reintentos básicos para errores temporales del proveedor.
const MAX_RETRIES_PER_MODEL = 2;
const RETRY_BASE_MS = 350;

function formatearNumeroPerfil(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return Number.isInteger(numero) ? String(numero) : numero.toFixed(1);
}

function buildPerfilUsuario(perfilUsuario) {
  const edad = formatearNumeroPerfil(perfilUsuario?.edad);
  const alturaCm = formatearNumeroPerfil(perfilUsuario?.alturaCm);
  const pesoKg = formatearNumeroPerfil(perfilUsuario?.pesoKg);

  const lineas = [
    edad ? `Edad: ${edad} anios` : null,
    alturaCm ? `Altura: ${alturaCm} cm` : null,
    pesoKg ? `Peso: ${pesoKg} kg` : null,
  ].filter(Boolean);

  if (!lineas.length) {
    return "No disponible. Si el usuario pide una recomendacion personalizada, solicita edad, estatura y peso de forma breve.";
  }

  return `${lineas.join("\n")}
Usa estos datos solo para ajustar porciones y recomendaciones generales. No hagas diagnosticos medicos.`;
}

// Construye el prompt final combinando personalidad, reglas, historial y
// el mensaje actual del usuario.
function buildPrompt(
  mensajeUser,
  tipoUsuario = "free",
  historial = [],
  esPrimeraCharla = false,
  perfilUsuario = null,
) {
  const historialTexto = historial.slice(-8).map(msg => 
    `[${msg.role.toUpperCase()}] ${msg.content}`
  ).join("\n\n");

  // Cambia el tono de entrada si es el primer mensaje de la conversación.
  const contexto = esPrimeraCharla 
    ? "PRIMERA CHARLA: incluye saludo rolo" 
    : "CONTINÚA: directo sin saludo";

  const perfilTexto = buildPerfilUsuario(perfilUsuario);

  // tipoUsuario queda disponible para futuras variantes del prompt.
  const prompt = `
[SISTEMA] ${pSistema}

[RULES] ${pRules}

[CONTEXTO] ${contexto}

[PERFIL_USUARIO]
${perfilTexto}

[HISTORIAL] ${historialTexto || "Charla nueva"}

[USUARIO] ${mensajeUser}

[LOGICA] ${pLogica}
`;

  return prompt;
}

// Elimina cualquier razonamiento o prefijo y deja solo la respuesta final.
function extractRespuesta(texto = "") {
  const limpio = String(texto || "").trim();
  const indice = limpio.indexOf(RESPUESTA_MARKER);
  if (indice === -1) return limpio;
  return limpio.slice(indice + RESPUESTA_MARKER.length).trim();
}

// Algunos modelos no soportan el método actual; en ese caso se cambia de modelo.
function isModelNotSupportedError(error) {
  const status = error?.status;
  const message = String(error?.message || "").toLowerCase();
  return (
    status === 404 ||
    message.includes("not found") ||
    message.includes("not supported for generatecontent")
  );
}

// Errores pasajeros donde sí merece la pena esperar y reintentar.
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

// Espera entre intentos para no golpear la API inmediatamente.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generación normal con fallback de modelos y reintentos por errores transitorios.
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

// Misma idea que generateWithFallback, pero para respuestas en streaming.
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

// Devuelve una respuesta completa del agente lista para consumirse por la API.
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

  // Gemini devuelve candidates con partes; aquí se consolidan en un solo texto.
  const candidate = respuesta.candidates?.[0];
  if (!candidate) {
    throw new Error("No se recibió ninguna candidate de Gemini");
  }

  const parts = candidate.content?.parts || [];
  const texto = parts
    .map((part) => part.text || "")
    .join(" ")
    .trim();

  return extractRespuesta(texto);
}

// Generador asíncrono para emitir solo el texto nuevo en cada fragmento.
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
    // chunk.text contiene la salida parcial del modelo.
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
    throw new Error("No se recibió texto de respuesta del agente");
  }

  if (emitted < finalText.length) {
    yield finalText.slice(emitted);
  }
}

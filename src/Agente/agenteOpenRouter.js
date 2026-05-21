import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  OPENROUTER_MODELOS_FALLBACK,
  getOpenRouterHeaders,
} from "../config/openrouter.js";
import { createChatCompletion, streamChatCompletion } from "./openAiCompatible.js";
import { buildPrompt, extractRespuesta } from "./promptBuilder.js";

function buildMessages(prompt) {
  return [{ role: "user", content: prompt }];
}

export async function AgenteOR(
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

  const texto = await createChatCompletion({
    providerName: "OpenRouter",
    endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
    headers: getOpenRouterHeaders(),
    models: OPENROUTER_MODELOS_FALLBACK,
    messages: buildMessages(prompt),
  });

  return extractRespuesta(texto);
}

export async function* AgenteORStream(
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

  let lastError = null;

  for (const model of OPENROUTER_MODELOS_FALLBACK) {
    let raw = "";
    let emitted = 0;
    let emittedAny = false;

    try {
      const rawStream = streamChatCompletion({
        providerName: "OpenRouter",
        endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
        headers: getOpenRouterHeaders(),
        model,
        messages: buildMessages(prompt),
      });

      for await (const deltaRaw of rawStream) {
        raw += deltaRaw;
        const textoActual = extractRespuesta(raw);
        const delta = textoActual.slice(emitted);

        if (delta) {
          emitted += delta.length;
          emittedAny = true;
          yield delta;
        }
      }

      const finalText = extractRespuesta(raw);
      if (!finalText) {
        throw new Error(`OpenRouter no devolvio texto de respuesta (${model})`);
      }

      if (emitted < finalText.length) {
        emittedAny = true;
        yield finalText.slice(emitted);
      }

      return;
    } catch (error) {
      if (emittedAny) throw error;
      lastError = error;
      console.warn(`OpenRouter stream modelo fallido: ${model}`, error.message);
    }
  }

  throw lastError || new Error("OpenRouter no tiene modelos disponibles para stream");
}

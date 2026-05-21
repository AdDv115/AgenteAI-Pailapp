const MAX_RETRIES_PER_MODEL = 2;
const RETRY_BASE_MS = 350;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isModelStatus(status) {
  return status === 400 || status === 404 || status === 422;
}

async function readErrorBody(response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

function buildError(providerName, model, response, bodyText) {
  const detalle = bodyText ? `: ${bodyText}` : "";
  const error = new Error(`${providerName} ${response.status} (${model})${detalle}`);
  error.status = response.status;
  return error;
}

async function postChat({ providerName, endpoint, headers, body }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const bodyText = await readErrorBody(response);
    throw buildError(providerName, body.model, response, bodyText);
  }

  return response;
}

export async function createChatCompletion({
  providerName,
  endpoint,
  headers,
  models,
  messages,
  temperature = 0.7,
}) {
  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
      try {
        const response = await postChat({
          providerName,
          endpoint,
          headers,
          body: {
            model,
            messages,
            temperature,
          },
        });

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
          throw new Error(`${providerName} no devolvio contenido (${model})`);
        }

        return content;
      } catch (error) {
        lastError = error;

        if (isModelStatus(error.status)) {
          console.warn(`${providerName} modelo no disponible: ${model}`);
          break;
        }

        if (isTransientStatus(error.status) && attempt < MAX_RETRIES_PER_MODEL) {
          const waitMs = RETRY_BASE_MS * (attempt + 1);
          console.warn(
            `${providerName} transient error (${model}) intento ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1}. Reintentando en ${waitMs}ms`,
          );
          await sleep(waitMs);
          continue;
        }

        throw error;
      }
    }
  }

  throw lastError || new Error(`${providerName} no tiene modelos disponibles`);
}

function parseSseMessages(buffer) {
  const messages = [];
  let current = buffer;
  let boundary = current.search(/\r?\n\r?\n/);

  while (boundary !== -1) {
    const rawEvent = current.slice(0, boundary);
    messages.push(rawEvent);
    current = current.slice(rawEvent.length).replace(/^\r?\n\r?\n/, "");
    boundary = current.search(/\r?\n\r?\n/);
  }

  return { messages, rest: current };
}

function extractDataLines(rawEvent) {
  return rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
}

function parseDeltaFromDataLine(dataLine) {
  if (dataLine === "[DONE]") return { done: true, delta: "" };

  const data = JSON.parse(dataLine);
  return {
    done: false,
    delta:
      data.choices?.[0]?.delta?.content ||
      data.choices?.[0]?.message?.content ||
      "",
  };
}

export async function* streamChatCompletion({
  providerName,
  endpoint,
  headers,
  model,
  messages,
  temperature = 0.7,
}) {
  const response = await postChat({
    providerName,
    endpoint,
    headers,
    body: {
      model,
      messages,
      temperature,
      stream: true,
    },
  });

  if (!response.body) {
    throw new Error(`${providerName} no devolvio stream (${model})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseMessages(buffer);
    buffer = parsed.rest;

    for (const rawEvent of parsed.messages) {
      for (const dataLine of extractDataLines(rawEvent)) {
        const { done: eventDone, delta } = parseDeltaFromDataLine(dataLine);
        if (eventDone) return;

        if (delta) {
          yield delta;
        }
      }
    }
  }

  const tail = decoder.decode();
  if (tail) {
    buffer += tail;
  }

  if (buffer.trim()) {
    for (const dataLine of extractDataLines(buffer)) {
      const { done: eventDone, delta } = parseDeltaFromDataLine(dataLine);
      if (eventDone) return;
      if (delta) yield delta;
    }
  }
}

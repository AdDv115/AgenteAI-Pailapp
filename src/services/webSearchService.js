import { GROQ_CHAT_COMPLETIONS_URL, getGroqHeaders } from "../config/groq.js";

const SEARCH_TRIGGERS = [
  "hoy",
  "actual",
  "actualidad",
  "reciente",
  "recientes",
  "ultimo",
  "ultima",
  "ultimos",
  "ultimas",
  "noticia",
  "noticias",
  "precio",
  "precios",
  "costo",
  "costos",
  "cuanto vale",
  "cuanto cuesta",
  "buscar",
  "busca",
  "internet",
  "temporada",
  "mercado",
  "ingredientes",
];

function normalizarTexto(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function necesitaBusqueda(mensaje = "") {
  const texto = normalizarTexto(mensaje);
  if (!texto) return false;

  return SEARCH_TRIGGERS.some((trigger) => texto.includes(trigger));
}

export async function webSearch(mensaje = "") {
  const query = String(mensaje || "").trim();
  if (!query) return "";

  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: getGroqHeaders({ "Groq-Model-Version": "latest" }),
    body: JSON.stringify({
      model: process.env.GROQ_SEARCH_MODEL || "groq/compound-mini",
      messages: [
        {
          role: "system",
          content:
            "Busca informacion web reciente y resume solo datos utiles para una recomendacion de cocina saludable en Colombia. Incluye precios aproximados cuando existan. Se breve.",
        },
        {
          role: "user",
          content: query,
        },
      ],
      compound_custom: {
        tools: {
          enabled_tools: ["web_search"],
        },
      },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const detalle = await response.text().catch(() => "");
    throw new Error(`Groq web search ${response.status}: ${detalle.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  return String(content || "").trim().slice(0, 3000);
}

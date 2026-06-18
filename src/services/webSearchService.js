/**
 * webSearchService.js
 * Servicio de busqueda web para enriquecer el contexto del agente.
 * Detecta si el mensaje del usuario requiere informacion actualizada
 * y realiza una busqueda usando la API de Tavily (o similar).
 */

// ── Palabras clave que indican que se necesita busqueda web ──────────────
const PALABRAS_BUSQUEDA = [
  "busca", "buscar", "busca en internet", "busca en la web",
  "que hay de", "qué hay de", "noticias", "actualmente", "hoy",
  "precio", "donde comprar", "receta de", "ingredientes de",
  "como hacer", "cómo hacer", "cuanto cuesta", "cuánto cuesta",
];

/**
 * Determina si el mensaje necesita una busqueda web.
 * @param {string} mensaje
 * @returns {boolean}
 */
export function necesitaBusqueda(mensaje) {
  if (!mensaje || typeof mensaje !== "string") return false;
  const lower = mensaje.toLowerCase();
  return PALABRAS_BUSQUEDA.some((palabra) => lower.includes(palabra));
}

/**
 * Realiza una busqueda web y devuelve un string con el contexto.
 * Usa la API de Tavily si TAVILY_API_KEY esta configurada.
 * Si no hay clave, retorna null sin romper el flujo.
 * @param {string} query
 * @returns {Promise<string|null>}
 */
export async function webSearch(query) {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    console.warn("[webSearchService] TAVILY_API_KEY no configurada, se omite busqueda web.");
    return null;
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 3,
      include_answer: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();

  // Construir contexto legible para el agente
  const resultados = (data.results || [])
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`)
    .join("\n\n");

  const respuestaDirecta = data.answer ? `Respuesta directa: ${data.answer}\n\n` : "";

  return `${respuestaDirecta}Fuentes:\n${resultados}`.trim() || null;
}

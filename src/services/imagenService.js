// ───────────────────────────────────────────────────────────────────────────
// imagenService.js
// Busca imagen del plato con cascada:
//   1. Spoonacular (si hay SPOONACULAR_API_KEY en .env)
//   2. Wikipedia / Wikimedia (gratis, sin key, cubre platos latinos)
//
// Para desactivar completamente:
//   1. Borra este archivo.
//   2. Borra src/routes/imagen-routes.js
//   3. Quita la línea de imagen-routes en src/app.js
// ───────────────────────────────────────────────────────────────────────────

const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY;
const SPOONACULAR_URL = "https://api.spoonacular.com/recipes/complexSearch";

// User-Agent requerido por Wikimedia API
const WIKI_UA = "PailApp/1.0 (contacto@pailapp.com)";

/**
 * Extrae el nombre del plato de la respuesta del agente.
 * Busca la línea que empiece con emoji de comida (formato del agente).
 */
export function extraerNombrePlato(respuesta = "") {
  const matchEmoji = respuesta.match(
    /[\u{1F32E}-\u{1F37F}\u{1F950}-\u{1F96F}\u{1F980}-\u{1F9FF}\u{2615}\u{1F374}\u{1F35C}-\u{1F364}\u{1F372}\u{1F373}]\s*([^\n\/]+)/u
  );
  if (matchEmoji) return matchEmoji[1].split("/")[0].trim();

  // Fallback: primera línea no vacía después de RESPUESTA:
  const lineas = respuesta.replace(/RESPUESTA:/i, "").split("\n").map(l => l.trim()).filter(Boolean);
  return lineas[0] || null;
}

// ───────────────────────────────────────────────────────────────────────────
// Fuente 1: Spoonacular
// ───────────────────────────────────────────────────────────────────────────
async function buscarEnSpoonacular(nombrePlato) {
  if (!SPOONACULAR_API_KEY) return null;

  try {
    const url = `${SPOONACULAR_URL}?query=${encodeURIComponent(nombrePlato)}&number=1&apiKey=${SPOONACULAR_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });

    if (!res.ok) {
      console.warn(`[Spoonacular] HTTP ${res.status} para "${nombrePlato}"`);
      return null;
    }

    const data = await res.json();
    const img = data?.results?.[0]?.image || null;
    if (img) console.info(`[Imagen] Spoonacular OK: ${img}`);
    return img;
  } catch (err) {
    console.warn(`[Spoonacular] Error: ${err.message}`);
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Fuente 2: Wikipedia (Wikimedia REST API) — 100% gratuito, sin key
// Busca primero en español, si no encuentra intenta en inglés.
// ───────────────────────────────────────────────────────────────────────────
async function buscarEnWikipedia(nombrePlato, lang = "es") {
  try {
    // Paso 1: buscar el artículo más relevante
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(nombrePlato)}&srlimit=1&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, {
      headers: { "User-Agent": WIKI_UA },
      signal: AbortSignal.timeout(5000),
    });
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const titulo = searchData?.query?.search?.[0]?.title;
    if (!titulo) return null;

    // Paso 2: obtener la imagen principal del artículo
    const pageUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titulo)}&prop=pageimages&pithumbsize=500&format=json&origin=*`;
    const pageRes = await fetch(pageUrl, {
      headers: { "User-Agent": WIKI_UA },
      signal: AbortSignal.timeout(5000),
    });
    if (!pageRes.ok) return null;

    const pageData = await pageRes.json();
    const pages = pageData?.query?.pages || {};
    const page = Object.values(pages)[0];
    const img = page?.thumbnail?.source || null;

    if (img) console.info(`[Imagen] Wikipedia (${lang}) OK: ${img}`);
    return img;
  } catch (err) {
    console.warn(`[Wikipedia][${lang}] Error: ${err.message}`);
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Función principal exportada: cascada Spoonacular → Wikipedia ES → Wikipedia EN
// ───────────────────────────────────────────────────────────────────────────
/**
 * Busca la imagen del plato con múltiples fuentes en cascada.
 * Retorna la primera URL que encuentre, o null.
 */
export async function buscarImagenPlato(nombrePlato) {
  if (!nombrePlato) return null;

  // 1. Spoonacular (solo si hay API key configurada)
  const imgSpoonacular = await buscarEnSpoonacular(nombrePlato);
  if (imgSpoonacular) return imgSpoonacular;

  // 2. Wikipedia en español
  const imgWikiEs = await buscarEnWikipedia(nombrePlato, "es");
  if (imgWikiEs) return imgWikiEs;

  // 3. Wikipedia en inglés (traducciones y platos internacionales)
  const imgWikiEn = await buscarEnWikipedia(nombrePlato, "en");
  if (imgWikiEn) return imgWikiEn;

  console.info(`[Imagen] No se encontró imagen para "${nombrePlato}"`);
  return null;
}

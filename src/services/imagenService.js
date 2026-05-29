// ─────────────────────────────────────────────────────────────────────────────
// imagenService.js
// Busca una imagen representativa del plato usando Spoonacular.
// Para desactivar esta funcionalidad completamente:
//   1. Borra este archivo.
//   2. Borra src/routes/imagen-routes.js
//   3. Quita la línea de imagen-routes en src/app.js
// ─────────────────────────────────────────────────────────────────────────────

const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY;
const BASE_URL = "https://api.spoonacular.com/recipes/complexSearch";

/**
 * Extrae el primer nombre de plato de una respuesta del agente.
 * Busca la línea que empiece con el emoji 🍲 o similar.
 */
export function extraerNombrePlato(respuesta = "") {
  // Buscar línea con emoji de comida seguida del nombre
  const matchEmoji = respuesta.match(/[\u{1F32E}-\u{1F37F}\u{1F950}-\u{1F96F}\u{1F980}-\u{1F9FF}\u{2615}\u{1F374}\u{1F35C}-\u{1F364}]\s*([^\n\/]+)/u);
  if (matchEmoji) return matchEmoji[1].split("/")[0].trim();

  // Fallback: buscar después de "RESPUESTA:" la primera línea no vacía
  const lineas = respuesta.replace(/RESPUESTA:/i, "").split("\n").map(l => l.trim()).filter(Boolean);
  return lineas[0] || null;
}

/**
 * Busca imagen en Spoonacular dado el nombre del plato.
 * Retorna la URL de la imagen o null si no encuentra / no hay API key.
 */
export async function buscarImagenPlato(nombrePlato) {
  if (!SPOONACULAR_API_KEY || !nombrePlato) return null;

  try {
    const url = `${BASE_URL}?query=${encodeURIComponent(nombrePlato)}&number=1&apiKey=${SPOONACULAR_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });

    if (!res.ok) {
      console.warn(`[Spoonacular] HTTP ${res.status} para "${nombrePlato}"`);
      return null;
    }

    const data = await res.json();
    return data?.results?.[0]?.image || null;
  } catch (err) {
    console.warn(`[Spoonacular] Error buscando imagen para "${nombrePlato}":`, err.message);
    return null;
  }
}

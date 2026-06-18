/**
 * webSearchService.js
 * Stub del servicio de busqueda web.
 * Por ahora no se usa busqueda externa, se deja el modulo
 * para no romper los imports de chat-routes.js.
 */

/**
 * Siempre retorna false: el agente no necesita busqueda web.
 * @param {string} mensaje
 * @returns {boolean}
 */
export function necesitaBusqueda(mensaje) {
  return false;
}

/**
 * Stub: no realiza ninguna busqueda.
 * @param {string} query
 * @returns {Promise<null>}
 */
export async function webSearch(query) {
  return null;
}

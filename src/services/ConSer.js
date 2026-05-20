import { getMySQL } from "../db/mysql.js";

const MAX_CONVERSACIONES_POR_USUARIO = 5;

const normalizarId = (valor, nombreCampo) => {
  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`${nombreCampo} invalido`);
  }

  return numero;
};

export function normalizarIdUsuario(idUsuario) {
  return normalizarId(idUsuario, "idUsuario");
}

export function normalizarConversationId(conversationId) {
  if (conversationId === undefined || conversationId === null || conversationId === "") {
    return null;
  }

  return normalizarId(conversationId, "conversationId");
}

export async function GetoCreateConvId(
  idUsuario,
  conversationId = null,
  { crearNueva = false } = {},
) {
  const idUsuarioNormalizado = normalizarIdUsuario(idUsuario);
  const conversationIdNormalizado = normalizarConversationId(conversationId);
  const pool = await getMySQL();
  const conn = await pool.getConnection();

  try {
    if (conversationIdNormalizado) {
      const [rows] = await conn.query(
        "SELECT id_conversacion FROM conversacion WHERE id_conversacion = ? AND id_usuario = ? AND estado = 'activa' LIMIT 1",
        [conversationIdNormalizado, idUsuarioNormalizado],
      );

      if (!rows.length) {
        throw new Error("Conversacion no encontrada o inactiva.");
      }

      return conversationIdNormalizado;
    }

    const [rows] = await conn.query(
      "SELECT id_conversacion FROM conversacion WHERE id_usuario = ? AND estado = 'activa' ORDER BY created_at DESC",
      [idUsuarioNormalizado],
    );

    const conversaciones = rows;

    if (!crearNueva && conversaciones.length > 0) {
      return conversaciones[0].id_conversacion;
    }

    if (conversaciones.length >= MAX_CONVERSACIONES_POR_USUARIO) {
      throw new Error(
        `El usuario ha alcanzado el limite de ${MAX_CONVERSACIONES_POR_USUARIO} conversaciones activas.`,
      );
    }

    const [result] = await conn.query(
      "INSERT INTO conversacion (id_usuario) VALUES (?)",
      [idUsuarioNormalizado],
    );

    return result.insertId;
  } finally {
    conn.release();
  }
}

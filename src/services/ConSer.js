import { getMySQL } from "../db/mysql.js";
import { eliminarHistorialMongo } from "../utils/chat-helpers.js";

const MAX_CONVERSACIONES_POR_USUARIO = 5;
const SQL_IDENTIFIER_REGEX = /^[a-zA-Z0-9_]+$/;

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

function sqlIdentifier(nombre, fallback) {
  const valor = String(nombre || fallback || "").trim();

  if (!SQL_IDENTIFIER_REGEX.test(valor)) {
    throw new Error(`Identificador SQL invalido: ${valor}`);
  }

  return `\`${valor}\``;
}

function normalizarNumeroPerfil(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function normalizarPerfilUsuario(row) {
  if (!row) return null;

  const perfil = {
    edad: normalizarNumeroPerfil(row.edad),
    alturaCm: normalizarNumeroPerfil(row.alturaCm),
    pesoKg: normalizarNumeroPerfil(row.pesoKg),
  };

  return Object.values(perfil).some((valor) => valor !== null) ? perfil : null;
}

export async function getPerfilUsuario(idUsuario) {
  const idUsuarioNormalizado = normalizarIdUsuario(idUsuario);
  const pool = await getMySQL();

  const tablaUsuario = sqlIdentifier(
    process.env.MYSQL_USUARIO_TABLE,
    "usuario",
  );
  const columnaId = sqlIdentifier(
    process.env.MYSQL_USUARIO_ID_COLUMN,
    "id_usuario",
  );
  const columnaEdad = sqlIdentifier(
    process.env.MYSQL_USUARIO_EDAD_COLUMN,
    "edad",
  );
  const columnaAltura = sqlIdentifier(
    process.env.MYSQL_USUARIO_ALTURA_COLUMN,
    "altura",
  );
  const columnaPeso = sqlIdentifier(
    process.env.MYSQL_USUARIO_PESO_COLUMN,
    "peso",
  );

  const [rows] = await pool.query(
    `SELECT ${columnaEdad} AS edad, ${columnaAltura} AS alturaCm, ${columnaPeso} AS pesoKg
     FROM ${tablaUsuario}
     WHERE ${columnaId} = ?
     LIMIT 1`,
    [idUsuarioNormalizado],
  );

  return normalizarPerfilUsuario(rows[0]);
}

export function normalizarConversationId(conversationId) {
  if (conversationId === undefined || conversationId === null || conversationId === "") {
    return null;
  }

  return normalizarId(conversationId, "conversationId");
}

async function eliminarConversacionMasAntigua(conn, idUsuario) {
  const [rows] = await conn.query(
    "SELECT id_conversacion FROM conversacion WHERE id_usuario = ? AND estado = 'activa' ORDER BY created_at ASC LIMIT 1",
    [idUsuario],
  );

  if (!rows.length) return;

  const idAntigua = rows[0].id_conversacion;

  await conn.query(
    "UPDATE conversacion SET estado = 'eliminada' WHERE id_conversacion = ?",
    [idAntigua],
  );

  // Limpiar también el historial en MongoDB
  await eliminarHistorialMongo(idAntigua, idUsuario);

  console.info(`[ConSer] Conversacion ${idAntigua} eliminada automaticamente (limite alcanzado para usuario ${idUsuario})`);
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

    // Si se alcanza el limite, eliminar la conversacion mas antigua automaticamente
    if (conversaciones.length >= MAX_CONVERSACIONES_POR_USUARIO) {
      await eliminarConversacionMasAntigua(conn, idUsuarioNormalizado);
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

import { getMySQL } from "../db/mysql.js";

const MAX_CONVERSACIONESPORUSUARIO = 5;

export async function GetoCreateConvId(idUsuario) {
    const pool = await getMySQL();
    const conn = await pool.getConnection();

    try {
        //Se obtiene conversaciones activas del usuario
        const [rows] = await conn.query(
            "SELECT id_conversacion FROM conversacion WHERE id_usuario = ? AND estado = 'activa' ORDER BY created_at ASC", [idUsuario]
        );

        const conversaciones = rows;

        if (conversaciones.length >= MAX_CONVERSACIONESPORUSUARIO) {

            throw new error(`El usuario ha alcanzado el límite de ${MAX_CONVERSACIONESPORUSUARIO} conversaciones activas.`);
    }
    
    const [result] = await conn.query("INSERT INTO conversacion (id_usuario) VALUES (?)", [idUsuario]);

    return result.insertId;

    } finally {
        conn.release();
    }
}
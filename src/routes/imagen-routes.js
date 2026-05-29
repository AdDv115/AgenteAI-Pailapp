// ─────────────────────────────────────────────────────────────────────────────
// imagen-routes.js
// GET /api/imagen?plato=arepa+de+choclo
// Retorna { imageUrl: string | null }
// Para desactivar: quitar este archivo y su import en app.js
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { buscarImagenPlato } from "../services/imagenService.js";

const router = Router();

router.get("/imagen", async (req, res) => {
  const plato = String(req.query.plato || "").trim();

  if (!plato || plato.length > 120) {
    return res.status(400).json({ error: "Param 'plato' requerido (max 120 chars)" });
  }

  const imageUrl = await buscarImagenPlato(plato);
  return res.json({ imageUrl });
});

export default router;

import app from "../src/app.js";

// Adaptador mínimo para exponer la app de Express en Vercel.
export default function handler(req, res) {
  return app(req, res);
}

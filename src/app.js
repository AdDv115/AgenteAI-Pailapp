import "dotenv/config";
import express from "express";
import cors from "cors";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import chatRouter from "./routes/chat-routes.js";
import ttsRouter from "./routes/tts-routes.js";
import tokenRouter from "./routes/token-routes.js";

const app = express();

// Cliente ElevenLabs 
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY2,
});

// middlewares globales
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// parser JSON para todo
app.use(express.json({ limit: "50mb" }));

// parser de texto SOLO para /api/tts
app.use("/api/tts", express.text({ type: "*/*", limit: "50mb" }));

// compartir elevenlabs con rutas
app.locals.elevenlabs = elevenlabs;

// healthcheck
app.get("/", (req, res) => {
  res.json({ status: "OK", message: "PAILAPP API corriendo" });
});

// rutas
app.use("/api", chatRouter);
app.use("/api", ttsRouter);
app.use("/api", tokenRouter);

// manejo de JSON malformado
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      error: "JSON invalido",
      detalle: 'Envia {"text":"hola"} o texto plano en el body para /api/tts',
    });
  }
  next(err);
});

// arranque local
export function startServer() {
  const PORT = process.env.PORT || 4000;
  return app.listen(PORT, () => {
    console.log(`PAILAPP API en http://localhost:${PORT}`);
  });
}

if (process.env.VERCEL !== "1") {
  process.on("SIGINT", () => {
    console.log("\nCerrando servidor...");
    process.exit(0);
  });

  startServer();
}

export { app };
export default app;

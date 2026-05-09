import { Router } from "express";

const router = Router();

// POST /api/get-token
router.post("/get-token", async (req, res) => {
  try {
    const { agentId, tipoUsuario = "free" } = req.body || {};
    if (!agentId) {
      return res.status(400).json({ error: "Falta agentId" });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/agents/${agentId}/tokens`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          permissions: ["agent:play", "agent:speak"],
          duration_seconds: 3600,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs: ${response.status}`);
    }

    const { token } = await response.json();
    res.json({ token, agentId, tipoUsuario });
  } catch (err) {
    console.error("Token error:", err);
    res.status(500).json({ error: "Error token" });
  }
});

export default router;
// Carga el cliente oficial de Gemini para Node.
import { GoogleGenAI } from "@google/genai";

// Clave usada por el SDK para autenticar todas las llamadas.
const apiKey = process.env.GEMINI_API_KEY;

// Si no existe la API key se falla al iniciar para detectar el problema pronto.
if (!apiKey) {
    throw new Error("Falta GEMINI_API_KEY");
}

// Instancia única reutilizable en los módulos que consultan Gemini.
export const ai = new GoogleGenAI({ apiKey });

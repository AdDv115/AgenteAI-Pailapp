# Pailapp API

Backend en Node.js para un agente conversacional enfocado en cocina saludable para estudiantes. Expone endpoints de chat normal, chat en streaming, texto a voz y generación de token para ElevenLabs.

## Que hace el proyecto

- Recibe mensajes desde un cliente.
- Recupera el historial del usuario en MongoDB.
- Construye un prompt con personalidad, reglas y contexto conversacional.
- Consulta Gemini para generar la respuesta.
- Puede devolver la respuesta completa o por partes usando SSE.
- Convierte texto a audio con ElevenLabs.

## Estructura

- `src/server/api.js`: servidor Express y endpoints HTTP.
- `src/Agente/agente.js`: composición del prompt, llamada a Gemini y fallback de modelos.
- `src/db/mongo.js`: conexión reutilizable a MongoDB.
- `src/config/gemini.js`: inicializa el cliente de Gemini.
- `src/prompts/*.js`: instrucciones del agente.
- `api/index.js`: adaptador para despliegue en Vercel.

## Flujo de chat

1. El cliente envía `mensaje` y `tipoUsuario`.
2. El servidor valida el texto y carga la conversación desde MongoDB.
3. Se agrega el nuevo mensaje del usuario al historial.
4. El agente arma el prompt con sistema, reglas, historial y lógica.
5. Gemini responde y el servidor guarda la respuesta en MongoDB.
6. El endpoint devuelve el resultado al cliente.

## Endpoints

- `GET /`: verificación básica de salud del servicio y de MongoDB.
- `POST /api/chat`: respuesta completa en JSON.
- `POST /api/chat/stream`: respuesta progresiva por Server-Sent Events.
- `POST /api/tts`: convierte texto a audio MP3 en base64.
- `POST /api/get-token`: crea un token temporal para un agente de ElevenLabs.

## Variables de entorno

- `GROQ_API_KEY`: clave de Groq, proveedor principal.
- `GROQ_MODEL`: modelo principal de Groq. Por defecto `llama-3.3-70b-versatile`.
- `GROQ_SEARCH_MODEL`: modelo Groq Compound para busqueda web. Por defecto `groq/compound-mini`.
- `OPENROUTER_API_KEY`: clave de OpenRouter para fallback intermedio.
- `OPENROUTER_MODEL`: modelo de OpenRouter. Por defecto `openrouter/auto`.
- `GEMINI_API_KEY2`: clave de Google Gemini para fallback final.
- `GEMINI_MODEL`: modelo preferido de Gemini; si falla, se prueban modelos alternos.
- `MONGODB_URI`: conexion a la base de datos.
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASS`, `MYSQL_DB`: conexion MySQL.
- `ELEVENLABS_API_KEY`: clave para texto a voz y tokens.

## Ejecutar localmente

```bash
npm install
npm start
```

El punto de entrada local es `src/server/api.js`.

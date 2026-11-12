# Investigación y decisiones (noviembre de 2026)

| Documento | Qué contiene | Estado |
|---|---|---|
| [FUNCIONES-AGENTICAS.md](FUNCIONES-AGENTICAS.md) | **Catálogo maestro**: 60 funciones de los asistentes investigados, qué tiene Orbe y en qué etapa se construye lo que falta | Vigente (12-nov) |
| [INVESTIGACION-ASISTENTES.md](INVESTIGACION-ASISTENTES.md) | Cómo funcionan dots, Grok Bot, Copilot, Claude, Codex, Gemini, Manus, Comet, OpenClaw y Hermes; recursos gratuitos; recomendación para Orbe | Aprobado (11-nov) |
| [COMPANERO-Y-CONFIGURACION.md](COMPANERO-Y-CONFIGURACION.md) | Compañero local («dos cerebros»), ojos opcionales, prompts exactos de los modelos y guía de configuración | Aprobado con cambios (12-nov) |
| [VISION-Y-DATOS.md](VISION-Y-DATOS.md) | Capa de visión propia (sin LiteLLM), consentimiento, EXIF, caché por hash, SQLite y `data/<usuario>/` | Aprobado (12-nov) |
| [SITIO-REGISTRO.md](SITIO-REGISTRO.md) | Registro en la web para novedades y borrador del protocolo de tratamiento de datos | Aprobado (12-nov); revisar §2 antes de publicar |
| [WHATSAPP-GOOGLE-PC.md](WHATSAPP-GOOGLE-PC.md) | Subagentes nativos del CLI de Claude, WhatsApp de la marca, Google ampliado y control del PC | Vigente (12-nov) |
| [PROMPT-CONSTRUCCION.md](PROMPT-CONSTRUCCION.md) | Prompt final para Claude Code en el PC: Etapas 5 a 18 y la web | Vigente (12-nov, rev. 2) |

## Registro de decisiones

| Fecha | Decisión |
|---|---|
| 11-nov-2026 | Investigación aprobada. Compañero local con Llama 3.2 añadido. |
| 12-nov-2026 | Sin LiteLLM; capa de visión propia en TypeScript configurada por `.env`. |
| 12-nov-2026 | La visión es opcional, con consentimiento; por defecto un modelo pequeño local. |
| 12-nov-2026 | Se retira «nada sale del PC»; se mantienen la minimización, EXIF fuera, caché y datos locales. |
| 12-nov-2026 | Orbe se prepara para otras personas; registro en la web solo para novedades. |
| 12-nov-2026 | Todas las funciones agénticas de la investigación entran en el plan (catálogo maestro, Etapas 5–15). |
| 12-nov-2026 | Subagentes: se reutilizan los del CLI de Claude (`--agents`); GPT solo como proveedor de modelo. |
| 12-nov-2026 | WhatsApp de la marca con aprobación de cada respuesta (no chat personal: sin teléfono y prohibido por Meta). Google ampliado. Control del PC con accesibilidad primero. Etapas 5–18. |

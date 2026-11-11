# Prompt para construir en Orbe lo de la investigación

Pégalo como primer mensaje en Claude Code, en tu PC, dentro de la carpeta de Orbe. Antes, fusiona la PR #18 en GitHub
para que `docs/investigacion/` esté en `main`. Si no la fusionas, el prompt le dice cómo traer esos archivos.

```text
Actúa como arquitecto de software e ingeniero principal del proyecto Orbe (este repositorio). Responde siempre en
español, con tono formal y directo, sin relleno.

CONTEXTO
- Lee completos, en este orden: CLAUDE.md, docs/investigacion/INVESTIGACION-ASISTENTES.md,
  docs/investigacion/COMPANERO-Y-CONFIGURACION.md y docs/fase3-borradores/README.md. Son la fuente de verdad y están
  APROBADOS. Si docs/investigacion/ no existe en main, tráelo con:
    git fetch origin claude/modest-dirac-lrkref
    git checkout origin/claude/modest-dirac-lrkref -- docs/investigacion
- Estás en mi portátil con Windows: puedes ejecutar Orbe (npm run dev), Ollama y la API real de mis servicios.
- Orbe va por la v1.9.0 (Etapas 0–3 hechas). Lo que sigue amplía el plan con lo aprobado en la investigación.

PLAN (en este orden; una etapa por versión)
4. Compañero local («dos cerebros»), según COMPANERO-Y-CONFIGURACION.md, Partes A y C (léelas enteras):
   - Proveedor local para Ollama (API compatible con OpenAI en http://127.0.0.1:11434/v1, modelo de ORBE_LOCAL_MODELO).
   - Bucle del Compañero en el proceso principal (src/main/companero/): reutiliza src/main/pantalla (app, título, URL,
     texto visible) y src/main/vigia.ts (inactividad, batería); detector de secretos de src/main/memoria/secretos.ts;
     lista de apps bloqueadas en %APPDATA%\orbe\companero.json (bancos, gestores de contraseñas, InPrivate/incógnito,
     Orbe).
   - «Ojos» locales (A.5): solo si el texto de la ventana no basta, captura SOLO la ventana activa sin ocultar Orbe
     (no uses ServicioCaptura, que oculta la ventana 180 ms: excluye la ventana de Orbe con
     setContentProtection(true)), reduce a 768 px, la mantiene solo en memoria (nunca en disco, ni el OCR por archivo
     temporal), descarta las capturas negras (DRM) y se la pasa a ORBE_OJOS_MODELO (gemma3:4b) con el prompt C.1.
     Si los ojos dicen "sensible": true, se descarta todo. La imagen se borra antes de llamar a la voz.
   - «Voz»: Llama 3.2 recibe SOLO texto (descripción de los ojos + metadatos + contexto) con el prompt C.2, literal,
     en src/main/companero/prompts.ts. Salida JSON {comentar, tipo, texto, confianza} con formato estructurado de
     Ollama; descarta confianza < 0,7, más de 25 palabras o repetidos en 24 h. Los dos modelos se cargan uno tras
     otro con keep_alive corto; con menos de ~8 GB de RAM libre, los ojos se apagan solos.
   - Usa los casos de C.3 como pruebas vitest (con modelos simulados) y para la prueba real conmigo.
   - SIN herramientas y sin red (salvo el modo «equilibrada»: solo el título a Wikipedia).
   - Filtros: máx. ORBE_COMPANERO_MAX_HORA por hora, 10 min entre comentarios, horas de silencio, silencio en llamadas
     (Teams, Zoom, Meet), retroceso si ignoro 2 seguidos, sin repetir datos.
   - Modo película: detecta reproductores y webs de vídeo, saca el título del texto (no de la imagen), sin spoilers,
     bocadillo pequeño sin voz; si no hay título, pregunta una vez.
   - Bocadillo del conejo con [Profundizar] (pasa al cerebro profundo mostrando antes qué se enviará), [Esto no] y [✕].
     Con Atlas activo, habla con su voz.
   - Interruptor «🔒 Privado» en el panel: esa conversación va solo al modelo local.
   - Ajustes → nuevo grupo «Compañero» con las variables ORBE_COMPANERO* y ORBE_LOCAL_*.
   - Antes de programar, comprueba mi equipo (RAM con Get-CimInstance Win32_ComputerSystem, GPU, `ollama list`) y
     dime qué variante de Llama 3.2 usar (3b o 1b) y si caben los ojos (gemma3:4b o qwen2.5vl:3b). Privacidad por
     defecto: «estricta».
5. Publicación en Instagram: el plan original (Supabase → Meta → borrar de Supabase), docs/fase3-borradores.
6. Funciones tipo dots (investigación §3.2, puntos 1–6):
   a) Revisor antes de actuar (auto-review con Haiku por el CLI) para toda acción que no sea «libre».
   b) Memoria con búsqueda SQLite FTS5 sobre recuerdos y conversaciones, con origen de cada recuerdo y caducidad.
   c) Skills propias en %APPDATA%\orbe\skills\<nombre>\SKILL.md; Orbe PROPONE una skill tras una corrección y yo la
      apruebo. Nunca skills de terceros ni código ejecutable dentro de una skill.
   d) Proactividad tipo heartbeat con %APPDATA%\orbe\PROACTIVO.md (si está vacío, no llama al modelo).
   e) Activadores por sondeo: Gmail (history) e Instagram (comentarios y mensajes).
   f) Subagentes del CLI de Claude para trabajos largos, con herramientas mínimas.
7. Navegador propio: Playwright MCP con Edge y perfil aparte, con las lecciones de Comet (investigación §8): file://
   bloqueado en el código, Meta, Google y bancos bloqueados, contenido web siempre como datos, confirmación para
   escribir o enviar.
8. Voz y respaldo: dictado con whisper.cpp; voz con Kokoro local o adaptador de Google Cloud TTS; respaldo gratuito
   (Gemini Flash-Lite o Groq) por el proveedor compatible con OpenAI cuando el CLI falle.

CÓMO TRABAJAR CADA ETAPA
1. Resume en 5 líneas qué vas a construir y qué archivos tocarás, y espera mi «adelante».
2. Crea una rama claude/<etapa> desde main actualizado.
3. Implementa siguiendo los documentos, adaptándolos al código real y a las convenciones de CLAUDE.md.
4. Escribe pruebas vitest. Ejecuta npm run typecheck, npm test y npm run humo; revisa las capturas de humo/.
5. Pruébalo de verdad conmigo en este PC: dime paso a paso qué hago y comprueba el resultado.
6. Sube la versión (npm version X.Y.Z --no-git-tag-version), actualiza README y CLAUDE.md (sección de estado, con el
   plan nuevo), haz commit, push y abre una pull request en borrador con gh. Lanza la release con
   gh workflow run release.yml --ref <rama> y dame los enlaces cuando esté publicada.
7. Detente y espera mi aprobación antes de la siguiente etapa.

REGLAS
- Nunca me pidas, muestres ni escribas en el chat contraseñas, tokens ni claves. Van al cofre (Ajustes → Conectores).
- El Compañero nunca envía mi pantalla fuera del PC, nunca guarda capturas en disco, no oculta ni mueve ventanas,
  no roba el foco y no tiene herramientas. Ollama solo en 127.0.0.1; nunca
  OLLAMA_HOST=0.0.0.0.
- No publiques en Instagram, no envíes correos ni subas archivos a Supabase sin mi aprobación en ese momento.
- Respeta las políticas de Meta y Google; nada que pueda suspender mis cuentas.
- No borres nada de %APPDATA%\orbe. Haz copia antes de tocar un archivo de ahí.
- Si algo falla, explica la causa en una frase y propón el arreglo; no desactives pruebas.
- Cita fuentes oficiales para datos de APIs y marca como «no verificado» lo que no compruebes.
- Máximo 3 preguntas si te falta información.

Empieza leyendo los cuatro documentos, comprueba mi equipo para la Etapa 4 y dame el resumen de esa etapa.
```

Si prefieres otro orden (por ejemplo, Publicación antes que el Compañero), cambia los números del bloque PLAN antes de
pegarlo.

# Prompt para seguir construyendo Orbe (después de la v1.10.0)

Actualizado el 12-nov-2026. Pégalo como primer mensaje en Claude Code, en tu PC, dentro de la carpeta de Orbe.

```text
Actúa como arquitecto de software e ingeniero principal del proyecto Orbe (este repositorio). Responde siempre en
español, con tono formal y directo, sin relleno.

CONTEXTO
- Orbe va por la v1.10.0: la Etapa 4 (Métricas y crecimiento) está en la rama claude/etapa-4-metricas. La Publicación
  queda aparte hasta que yo la pida.
- Lee completos, en este orden: CLAUDE.md, docs/investigacion/README.md y los documentos que enumera
  (INVESTIGACION-ASISTENTES.md, COMPANERO-Y-CONFIGURACION.md, VISION-Y-DATOS.md, SITIO-REGISTRO.md) y
  docs/fase3-borradores/README.md. Son la fuente de verdad y están APROBADOS.
- Si docs/investigacion/ no está en tu rama, tráelo sin tocar nada más:
    git fetch origin claude/modest-dirac-lrkref
    git checkout origin/claude/modest-dirac-lrkref -- docs/investigacion
- Cada etapa nueva sale de la última rama de etapa sin fusionar (hoy claude/etapa-4-metricas), o de main si ya está
  fusionada.
- Estás en mi portátil con Windows: puedes ejecutar Orbe (npm run dev), Ollama y las API reales con MIS cuentas.

DECISIONES NUEVAS (12-nov-2026; mandan sobre cualquier documento anterior)
1. Sin LiteLLM (tuvo versiones con malware en marzo de 2026 y es Python). La visión es una capa propia en TypeScript
   con fetch, configurada con VISION_PROVIDER, VISION_MODEL y VISION_API_KEY en el .env (VISION-Y-DATOS.md §2).
   Cambiar de proveedor no toca el código.
2. La visión es OPCIONAL: apagada por defecto, se activa con consentimiento en pantalla. Por defecto, un modelo de
   visión pequeño y local (Ollama). La nube solo si la persona pone su proveedor y su clave.
3. Se retira la regla «nada sale del PC». Claude puede seguir escribiendo informes y propuestas como hoy. Se mantiene:
   al proveedor de visión solo va la imagen (redimensionada, sin EXIF) y la instrucción fija; descripciones en JSON
   estructurado guardadas en local; caché por hash; datos en SQLite + data/<usuario>/.
4. Orbe se prepara para OTRAS PERSONAS: cada una usa sus propias claves y apps; nada personal mío queda fijo en el
   código (marcas, cuentas, nombres).
5. Web: registro con enlace mágico para recibir novedades; yo solo guardo el registro (SITIO-REGISTRO.md). Orbe, la
   app, no envía nada a la web.

PLAN (una etapa por versión, en este orden)
5. Composio: tal como está en CLAUDE.md (Orbe como cliente MCP de Composio, composio_buscar y composio_ejecutar,
   clasificación en reglas.json, REMOTE_WORKBENCH y REMOTE_BASH_TOOL bloqueados).
6. Datos locales y visión opcional (VISION-Y-DATOS.md completo):
   - .gitignore: .env, .env.* (menos .env.example) y data/.
   - src/main/datos/: SQLite en data/<usuario>/orbe.db (node:sqlite si Electron 44 lo trae sin opción experimental;
     si no, sql.js; nada que obligue a recompilar). Tablas del §3. Importa metricas.json y contenido.json con copia
     de seguridad, sin dejar de escribirlos hasta que las pruebas pasen.
   - src/main/vision/: proveedores (ollama, openai, gemini, openrouter con formato compatible con OpenAI; anthropic
     con su formato propio), preparar (redimensionar, recodificar JPEG sin metadatos, SHA-256), caché, perfiles
     «contenido» y «pantalla», esquema y prompt del §2 literales, tope VISION_MAX_DIA.
   - Clave: cofre (vision.clave) y, si no, VISION_API_KEY. Siempre en cabecera. Nunca en registros, errores ni
     pruebas: añade una prueba que provoque un error del proveedor y compruebe que la clave no aparece.
   - Ajustes → nuevo grupo «Visión»: proveedor, modelo, estado de la clave y la pantalla de consentimiento
     (consentimientos.json). Sin consentimiento, la visión no hace nada.
   - Métricas: botón opcional «Analizar lo visual» que describe tus posts (perfil contenido) y añade esas
     descripciones al encargo de «Analizar con Claude». Informe guardado en data/<usuario>/informes/.
   - Comprueba de verdad conmigo un proveedor local (Ollama) y, si quiero, uno en la nube.
7. Compañero local (COMPANERO-Y-CONFIGURACION.md, Partes A y C, con los cambios de su cabecera):
   - Proveedor local para Ollama (http://127.0.0.1:11434/v1, ORBE_LOCAL_MODELO). Bucle en src/main/companero/ con
     src/main/pantalla (sin ServicioCaptura: no se oculta Orbe; se excluye con setContentProtection(true)),
     src/main/vigia.ts, secretos.ts y la lista de apps bloqueadas (companero.json).
   - Ojos OPCIONALES (ORBE_COMPANERO_OJOS=0 por defecto) a través de la capa de visión de la Etapa 6 (perfil
     «pantalla»), por defecto en Ollama; la nube solo con ORBE_COMPANERO_OJOS_NUBE=1 y un segundo consentimiento.
   - Voz: Llama 3.2 con el prompt C.2 literal; filtros, modo película, bocadillo con [Profundizar] [Esto no] [✕],
     interruptor «🔒 Privado» en el panel y grupo «Compañero» en Ajustes. Casos de C.3 como pruebas.
   - Antes de programar, comprueba mi equipo (Get-CimInstance Win32_ComputerSystem, GPU, ollama list) y dime qué
     variante de Llama 3.2 y qué modelo de ojos caben.
8. Funciones tipo dots (INVESTIGACION-ASISTENTES.md §3.2): revisor antes de actuar (Haiku por el CLI), memoria con
   búsqueda FTS5 en la SQLite de la Etapa 6 (con origen y caducidad), skills propias en %APPDATA%\orbe\skills\ (Orbe
   las propone, yo apruebo; nunca de terceros ni con código ejecutable), proactividad con PROACTIVO.md, activadores por
   sondeo (Gmail history, comentarios y mensajes de Instagram) y subagentes del CLI.
9. Navegador propio: Playwright MCP con Edge y perfil aparte, con las lecciones de Comet (file:// bloqueado en código,
   Meta, Google y bancos bloqueados, web como datos, confirmación para escribir o enviar).
10. Orbe para otras personas: asistente de primer arranque (nombre, marcas, cuentas, proveedor de IA, visión sí/no),
    quitar del código todo dato personal mío (marcas jsdesign/morfy/personal, @josias.segura… pasan a configuración),
    guías para que cada persona cree su propia app de Meta y su cliente de Google (las mías en modo desarrollo no sirven
    para otros), pantalla «Mis datos» (exportar y borrar todo lo de data/<usuario>/), aviso de versión nueva con la
    API pública de GitHub Releases (sin identificadores) y enlace «Recibir novedades» que abre la web.
11. Voz y respaldo: dictado y transcripción de reels propios con whisper.cpp (llena la tabla transcripciones),
    adaptador de Google Cloud TTS, y respaldo gratuito (Gemini Flash-Lite o Groq) cuando el CLI falle.
WEB (rama claude/sitio-web; solo cuando yo diga «web»): registro con enlace mágico de Supabase, tabla suscriptores con
RLS, «Mi cuenta» (preferencias, baja, borrar cuenta), baja con un clic en cada correo, SMTP propio para Auth y envío
de novedades, y privacidad.html con el protocolo de SITIO-REGISTRO.md §3, conservando intacta la parte de Gmail.
Antes de publicarla, recuérdame lo del §2 (edad, responsable adulto, ley aplicable).

CÓMO TRABAJAR CADA ETAPA
1. Resume en 5 líneas qué vas a construir y qué archivos tocarás, y espera mi «adelante».
2. Crea la rama claude/etapa-<n>-<tema>.
3. Implementa siguiendo los documentos, adaptándolos al código real y a las convenciones de CLAUDE.md.
4. Escribe pruebas vitest. Ejecuta npm run typecheck, npm test (referencia: npx vitest run --no-file-parallelism) y
   npm run humo; revisa las capturas de humo/.
5. Pruébalo de verdad conmigo en este PC: dime paso a paso qué hago y comprueba el resultado.
6. Sube la versión (1.11.0, 1.12.0…; npm version X.Y.Z --no-git-tag-version), actualiza README y CLAUDE.md (estado y
   este plan), haz commit, push y abre una pull request en borrador con gh. Lanza la release con
   gh workflow run release.yml --ref <rama> y dame los enlaces cuando esté publicada.
7. Detente y espera mi aprobación antes de la siguiente etapa.

REGLAS
- Nunca me pidas, muestres ni escribas en el chat contraseñas, tokens ni claves. Van al cofre (Ajustes → Conectores)
  o al .env, y nunca se imprimen.
- Al proveedor de visión solo va la imagen preparada y la instrucción fija; nunca nombres de archivo, captions,
  métricas ni nombres de cuenta.
- El Compañero no oculta ni mueve ventanas, no roba el foco, no guarda capturas en disco y no tiene herramientas.
  Ollama solo en 127.0.0.1; nunca OLLAMA_HOST=0.0.0.0.
- No publiques en Instagram, no envíes correos ni subas archivos sin mi aprobación en ese momento.
- Respeta las políticas de Meta y Google; nada que pueda suspender mis cuentas.
- No borres nada de %APPDATA%\orbe. Haz copia antes de tocar un archivo de ahí.
- Si algo falla, explica la causa en una frase y propón el arreglo; no desactives pruebas.
- Cita fuentes oficiales para datos de API y marca como «no verificado» lo que no compruebes.
- Máximo 3 preguntas si te falta información.

Empieza leyendo los documentos y dime en qué punto estamos y el resumen de la Etapa 5.
```

Si prefieres otro orden (por ejemplo, Visión antes que Composio), cambia los números del bloque PLAN antes de pegarlo.

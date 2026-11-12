# Investigación: cómo funcionan los mejores asistentes de IA (noviembre de 2026)

> Objetivo: desglosar cada componente agéntico de los asistentes de referencia para decidir **qué añadir a Orbe**
> (v1.9.0, Etapas 0–3 hechas) y con qué recursos gratuitos o de código abierto.
> Estado: **Fases 1–3 terminadas. Pendiente de revisión del usuario.** No incluye plan de construcción.
>
> Convenciones: **[oficial]** = documentación o blog del fabricante; **[terceros]** = prensa o blogs técnicos;
> **no verificado** = sin fuente o con fuentes contradictorias; *análisis propio* = deducción, no dato publicado.
>
> Limitación de esta investigación: desde el entorno de trabajo no se pudieron abrir `help.openai.com` ni `docs.x.ai`
> (bloqueados por la red). Lo que se cita de ellas procede de los fragmentos que devuelve el buscador, no de la página
> completa.

---

## Verificación de nombres

| Nombre pedido | Producto analizado |
|---|---|
| «Dots» de OpenAI | **dots** de ChatGPT (DevDay, 29-sep-2026) |
| Grok y «GrokBot» | **Grok** (chat) y **Grok Bot** (plataforma de agentes, beta desde el 11-ago-2026). No el rastreador web «GrokBot» |
| Copilot / Copilot Agent | Familia de **GitHub Copilot**: cloud/coding agent, Copilot CLI, Agent HQ y Copilot Memory |
| Claude | **Claude** (app con Cowork y Claude in Chrome), **Claude Code** y **Claude Agent SDK** |
| Otros referentes | **OpenAI Codex**, **Gemini Agent**, **Manus**, **Perplexity Comet** y dos de código abierto: **OpenClaw** y **Hermes Agent** |

---

# FASE 1 · Análisis de cada asistente

## 1. OpenAI dots (ChatGPT)

**a) Qué es y para quién.** Agentes personales «siempre activos» dentro de ChatGPT. Cada dot tiene **su propio
ordenador y navegador en la nube** y sigue trabajando aunque cierres la pestaña. Al lanzarse está disponible en ChatGPT
Pro y Business Premium, con beta en Enterprise, Edu y Healthcare. Hay un dot por usuario; más adelante habrá más. Sin
la UE, Suiza ni Reino Unido en el lanzamiento de Pro **[terceros]**. Precio del plan Pro: **no verificado** (las fuentes dicen
100 $ o 500 $/mes).

**b) Arquitectura por componente**

| Componente | Cómo lo hace | Fuente |
|---|---|---|
| Modelo y razonamiento | GPT-6 Astra | [terceros] |
| Bucle del agente | Planifica → actúa en su ordenador en la nube → **auto-review** revisa ciertas acciones planificadas contra tus instrucciones, tus reglas y la seguridad *antes* de ejecutarlas → un monitor de seguridad puede pausar el trabajo | [oficial, FAQ de seguridad] |
| Herramientas | Navegador y ordenador propios en la nube, apps conectadas de ChatGPT («4.000+ apps» según el lanzamiento); con el ordenador local activado puede crear tareas de ChatGPT Work o Codex y usar *skills* locales | [oficial] / [terceros] |
| Memoria | Comparte la memoria de ChatGPT, y lo que el dot guarda se gestiona desde los ajustes de memoria de ChatGPT; desactivar la memoria corta ese intercambio | [oficial] |
| Subagentes | No documentado para el usuario. «ChatGPT Space» permite que varios dots colaboren con equipos humanos | [terceros]; detalle **no verificado** |
| Integraciones | Apps conectadas (correo, calendario, archivos…); Slack y Teams como canales | [oficial] / [terceros] |
| Segundo plano y programación | Recordatorios y tareas recurrentes (página «Scheduled»); **tareas por evento** mediante webhooks; una acción que requiere aprobación pausa la tarea | [oficial] |
| Interfaz | Chat y llamada de voz en ChatGPT (escritorio, web, móvil), Slack y Teams; avatar animado («bubbly agentic avatar») | [terceros] |
| Seguridad y permisos | 3 niveles: (1) lo más sensible (cambiar contraseñas, transferir dinero) exige que **tú tomes el control**; (2) borrar datos o instalar software pide **aprobación cada vez**; (3) el resto, aprobación que a veces se da por adelantado. **Custom Rules**: permiten, obligan a consultar o prohíben acciones, pero no dan acceso nuevo ni anulan las salvaguardas. El acceso al ordenador local viene **desactivado**. OpenAI admite que esto **reduce, no elimina**, la inyección de instrucciones | [oficial] |

**c) Público vs. supuesto.** Los permisos, la memoria, las tareas y el acceso local están documentados. **No verificado**:
el precio, cómo se decide internamente qué acción pasa por auto-review y cómo colaboran varios dots. Las fuentes oficiales
reconocen además un hueco de auditoría: en el acceso local no hay registro completo de cada orden y archivo **[terceros
citando la Compliance API]**.

---

## 2. Grok y Grok Bot (xAI)

**a) Qué es y para quién.** *Grok* es el chatbot y la familia de modelos de xAI (Grok 4.6). *Grok Bot* es una
plataforma de «compañeros de equipo» de IA, hecha con Cursor y en beta desde el 11-ago-2026. Tiene apps para Mac,
Windows, Linux e iOS, con Android pendiente. Acceso inicial con SuperGrok Heavy y planes altos de Cursor; otra fuente lo
incluye en la suscripción de X desde 30 $/mes. Planes exactos: **no verificado**.

**b) Arquitectura por componente**

| Componente | Cómo lo hace | Fuente |
|---|---|---|
| Modelo | **No verificado**: las fuentes dicen Grok 4.6 o que delega en Claude Opus; el anuncio no nombra el modelo | [terceros] |
| Bucle del agente | Cada Bot trabaja en su propia «pantalla» del ordenador compartido, con las mismas apps y webs que usaría una persona | [oficial] |
| Herramientas | **Skills** de cuenta (flujos reutilizables: navegar, documentos, correo) y **conectores** a apps; cuando hace falta iniciar sesión en una web, el Bot ofrece el conector correspondiente | [oficial] / [terceros] |
| Memoria | **Por Bot**: preferencias, contexto de su rol y resúmenes de trabajo previo. Unos pocos datos (tu nombre, zona horaria) se comparten entre todos. La documentación pide **comprobar los datos importantes** en vez de fiarse de la memoria y guardar contraseñas y tarjetas en el **Vault**, no en la memoria | [oficial, FAQ] |
| Subagentes | Varios Bots con nombre; un Bot puede enviar un **mensaje asíncrono** a otro, que despierta, lo atiende y responde más tarde | [terceros] |
| Integraciones | Conectores; Slack; en Bots de equipo, cada compañero usa **sus** conectores y su memoria | [terceros] |
| Segundo plano | **Routines** por Bot (límites citados: hasta 300 ejecuciones por hora en total y 200 por rutina) | [oficial, changelog] |
| Interfaz | Apps de escritorio y móvil, Slack | [terceros] |
| Seguridad | Un **solo ordenador persistente por usuario**: la documentación avisa de que **los Bots no son una frontera de seguridad** entre sí. Aprobaciones para acciones sensibles | [oficial, FAQ] |

**c) Público vs. supuesto.** La memoria, el Vault, el ordenador compartido y las rutinas están documentados. **No
verificado**: el modelo, los límites exactos y si el Vault funciona en Bots compartidos (las fuentes se contradicen).

---

## 3. GitHub Copilot (cloud agent, CLI, Agent HQ, Memory)

**a) Qué es y para quién.** Asistente de programación. El **cloud agent** (antes «coding agent») recibe una issue o una
orden, trabaja solo y abre una pull request. **Copilot CLI** es el agente de terminal, disponible para todos desde el
25-feb-2026. **Agent HQ** (preview desde el 4-feb-2026) reúne en GitHub agentes de Anthropic, OpenAI, Google y otros.

**b) Arquitectura por componente**

| Componente | Cómo lo hace | Fuente |
|---|---|---|
| Modelo | Varios a elegir; Agent HQ añade Claude y Codex como agentes completos | [terceros] |
| Bucle del agente | Entorno **efímero de GitHub Actions** → planifica → edita → ejecuta pruebas → abre PR → el humano revisa | [oficial / Microsoft Learn] |
| Herramientas | Solo **herramientas** de MCP (no *resources* ni *prompts*); por defecto los servidores de GitHub y de **Playwright**; los servidores MCP configurados se usan **sin pedir aprobación** en cada llamada | [oficial] |
| Memoria | **Copilot Memory** (GA el 28-oct-2026): recuerdos **por repositorio** con citas al código, creados solo a partir de acciones de personas con permiso de escritura y revisables o borrables en Ajustes. Se comparte entre la app, el CLI, el cloud agent, la revisión de código y Slack/Teams. «Dreaming» (consolidación) en preview. Caducidad: **no verificado** (28 o 90 días) | [oficial] |
| Subagentes | **Custom agents** (perfiles con sus propios servidores MCP); varios agentes de distintos fabricantes en Agent HQ | [oficial] |
| Integraciones | GitHub, VS Code, móvil, Slack, Teams | [oficial] |
| Segundo plano | El cloud agent trabaja asíncrono en Actions | [oficial] |
| Interfaz | Web de GitHub, IDE, terminal, móvil | [oficial] |
| Seguridad | **Cortafuegos** de salida activado por defecto, que solo cubre lo que lanza su Bash, no los servidores MCP; lista de hosts permitidos; el trabajo siempre acaba en PR que revisa una persona | [oficial] |

**c) Público vs. supuesto.** Está bien documentado. **No verificado**: la caducidad de la memoria y los modelos
disponibles en cada plan.

---

## 4. Claude (app, Cowork, Claude in Chrome, Claude Code, Agent SDK)

**a) Qué es y para quién.** *Claude* es el chat. *Cowork* es su modo de trabajo agéntico con tareas programadas y
conectores. *Claude in Chrome* es la extensión de navegador. *Claude Code* es el agente de programación (terminal,
escritorio, web). El *Agent SDK* es el mismo motor de Claude Code como librería (Python y TypeScript). **Orbe ya usa
Claude Code** por `claude -p`.

**b) Arquitectura por componente**

| Componente | Cómo lo hace | Fuente |
|---|---|---|
| Modelo y razonamiento | Familia Claude 5 (Opus, Sonnet, Haiku) con pensamiento extendido; *plan mode* en Claude Code | [oficial] |
| Bucle del agente | Bucle de herramientas: el modelo pide una herramienta → el arnés la ejecuta según los permisos → devuelve el resultado → repite hasta terminar. **Hooks** (PreToolUse, PermissionRequest, Stop…) permiten aprobar, bloquear o forzar que continúe | [oficial] |
| Herramientas | Read/Edit/Bash/Web, **MCP** (cliente y servidor), **Skills** (carpetas con `SKILL.md` cuya descripción se carga al inicio y el contenido completo solo al usarse), plugins | [oficial] |
| Memoria | **CLAUDE.md** jerárquico (política de empresa, usuario, proyecto) que va en cada sesión, más **memoria automática** en `~/.claude/projects/<proyecto>/memory/` (`MEMORY.md`, con los primeros 200 renglones o 25 KB al arrancar). En la app, memoria de chats y proyectos compartida con Cowork | [oficial] / [terceros] |
| Subagentes | Subagentes con **contexto aislado**, sus propias herramientas, modo de permisos y memoria; pueden ir en segundo plano. La concurrencia máxima (20) es **no verificada** | [oficial] / [terceros] |
| Integraciones | Conectores de claude.ai (Gmail, Calendar, Drive…), MCP locales solo en la app de escritorio | [oficial] |
| Segundo plano | **Tareas programadas de Cowork en la nube** (no necesitan el PC encendido); en Claude Code, sesiones en la nube y tareas programadas | [oficial] |
| Interfaz | Chat web, escritorio y móvil, voz, Chrome, terminal, IDE, Slack | [oficial] |
| Seguridad | Modos de permiso (`default`, `acceptEdits`, `plan`, `dontAsk`, `auto`), listas allow/deny, **sandbox** de Bash (Linux y Mac), avisos de que los hooks se ejecutan con tus credenciales | [oficial] / [terceros] |

**c) Público vs. supuesto.** Es el más documentado. **No verificado**: el estado del cambio de facturación del Agent SDK
anunciado para el 15-jun-2026 (un resumen de terceros dice que se pausó, mientras la documentación aún lo menciona). Esto
**afecta a Orbe**, que usa `claude -p` con la suscripción.

---

## 5. OpenAI Codex (referente de agente de código local)

| Componente | Cómo lo hace | Fuente |
|---|---|---|
| Qué es | Agente de programación: CLI de **código abierto (Apache-2.0, en Rust)**, más app y versión en la nube | [terceros] |
| Bucle | Al arrancar: sandbox → carga la cadena de `AGENTS.md` → descubre servidores MCP → registra las herramientas. Cada orden pasa por un *ToolRouter* que aplica la política de aprobación antes de lanzar el proceso | [terceros] |
| Memoria | `AGENTS.md` en cascada (global → repositorio → subcarpeta, tope de 32 KiB) | [terceros] |
| Subagentes | Puede invocar subagentes definidos en `AGENTS.md` | [terceros] |
| Seguridad | **Sandbox y aprobación son dos ajustes separados**: sandbox `read-only`, `workspace-write` o `danger-full-access`; aprobación `untrusted`, `on-request` o `never`. Las empresas pueden forzarlos con `requirements.toml` | [terceros] |

Interés para Orbe: la separación sandbox/aprobación y el diseño de su bucle (código abierto, se puede leer).

## 6. Google Gemini Agent

| Componente | Cómo lo hace | Fuente |
|---|---|---|
| Qué es | Modo agéntico unificado de la app Gemini. **Absorbió Project Mariner** (cerrado como producto el 4-may-2026) | [terceros, Wikipedia] |
| Bucle | «Reasoning chains»: divide un objetivo en subtareas y orquesta varias apps de Google (busca en Drive y Gmail y crea un Doc o un evento) | [terceros] |
| Segundo plano | «Gemini Spark»: versión que funciona con horario | **no verificado** (una sola fuente) |
| Límites conocidos | Lento al localizar dónde hacer clic, se atasca en reservas, se rinde ante CAPTCHAs e inicios de sesión | [terceros] |

## 7. Manus (Meta)

| Componente | Cómo lo hace | Fuente |
|---|---|---|
| Qué es | Agente general comercial; **comprado por Meta** (anunciado el 29-dic-2025); sigue funcionando como servicio aparte | [terceros] |
| Arquitectura | Una **máquina virtual en la nube por sesión**, que se destruye al acabar | [oficial, blog de Manus] |
| Subagentes | **Wide Research**: lanza en paralelo muchas instancias completas de Manus, no roles fijos. «Hasta 100» es **no verificado** | [oficial] / [terceros] |

## 8. Perplexity Comet (navegador con agente)

Interesa sobre todo como **lección de seguridad** para la Etapa 6 de Orbe (navegador propio):
- Zenity Labs (feb–mar 2026): una invitación de calendario con instrucciones ocultas hizo que el agente leyera archivos
  locales (`file://`) y entrara en un 1Password con sesión iniciada. Perplexity bloqueó `file://` **en el código**, endureció
  las confirmaciones y dejó desactivar el agente por dominio **[terceros]**.
- Trail of Bits (auditoría previa al lanzamiento) sacó datos de Gmail con 4 técnicas de inyección **[oficial, blog de ToB]**.
- Brave mostró que obedecía instrucciones escondidas en webs normales **[terceros]**.

## 9. OpenClaw (código abierto, asistente personal local)

| Componente | Cómo lo hace | Fuente |
|---|---|---|
| Qué es | Asistente personal **autoalojado**, muy popular a principios de 2026 (más de 100 000 estrellas, **no verificado** con exactitud). Repositorio `openclaw/openclaw`; licencia MIT **no verificada** en el repositorio | [terceros] |
| Arquitectura | **Gateway** central entre los canales de mensajería (WhatsApp, Telegram, Slack, Discord…) y los proveedores de modelos | [terceros] |
| Herramientas | **Skills** con `SKILL.md`; registro comunitario **ClawHub** | [terceros] |
| Proactividad | **Heartbeat**: cada 30 min (por defecto) lanza un turno en segundo plano que lee `HEARTBEAT.md` y decide si actúa; si el archivo está vacío, se lo salta para no gastar llamadas | [terceros] |
| Seguridad (lección) | Auditoría de Koi: **341 de 2.857 skills de ClawHub eran maliciosas**; Snyk: el 13,4 % con fallos críticos y alrededor del 36 % con inyección de instrucciones; CVE por meter contenido web sin sanear en el contexto; **decenas de miles de instancias expuestas** en internet (42 000–135 000 según la fuente) | [terceros: The Hacker News, Snyk] |

## 10. Hermes Agent (Nous Research, código abierto)

| Componente | Cómo lo hace | Fuente |
|---|---|---|
| Qué es | Agente de código abierto (MIT) que **mejora solo**; repositorio `NousResearch/hermes-agent` | [terceros] |
| Memoria | Archivos **Markdown** (`memory.md`, `user.md`) + **búsqueda de texto completo FTS5** sobre sesiones pasadas con resumen por el modelo | [terceros] |
| Aprendizaje | Cuando resuelve una tarea de varios pasos o recibe una corrección, la guarda como **skill** (`SKILL.md`, estándar agentskills.io) y la mejora la próxima vez que la usa | [terceros] |
| Crítica | El aprendizaje hace que las ejecuciones sean menos reproducibles | [terceros] |

---

# FASE 2 · Recursos gratuitos y código base por componente

## 2.1 Lo que Orbe ya tiene (v1.9.0, en `main`)

| Componente | En Orbe | Equivalente en los referentes |
|---|---|---|
| Modelo | CLI de Claude (suscripción), API de Anthropic o API compatible con OpenAI | Todos |
| Bucle y herramientas | Modo agente; herramientas propias servidas al CLI por **MCP** (`mcp__orbe__*`); Gmail, Instagram (lectura), contenido, web, abrir apps | Claude Code, Copilot |
| Memoria | Recuerdos en `.md` (máx. por presupuesto), conversación guardada, importación de la memoria de Claude, detector de secretos | Hermes, Claude Code |
| Permisos | `reglas.json` con 4 comportamientos + `bloqueado`; cofre cifrado (DPAPI) | dots (Custom Rules), Codex |
| Segundo plano | Tareas programadas tipo dots, cola, avisos de Windows | dots, Grok Bot, Cowork |
| Interfaz | Conejo 3D + panel, voz de Windows (neuronal aplazada), lectura de pantalla y OCR | dots (avatar) |
| Identidad | Atlas | — |
| Pendiente del plan | Etapa 4 (publicar), **5 (revisor, activadores, aprendizaje)**, 6 (navegador) | — |

## 2.2 Componentes que faltan y con qué construirlos

Licencias y estrellas de terceros, con fecha de 2026; **comprobar en GitHub** antes de usarlos.

| Componente | Opción recomendada | Licencia / estado | Alternativas | Reutilizar / adaptar / construir |
|---|---|---|---|---|
| **Auto-review** (revisor antes de actuar) | Una segunda llamada barata (Haiku por el CLI) que compara la acción con la orden y `reglas.json`, como dots | — | Hooks `PreToolUse` de Claude Code | **Construir** (ya está en borrador, Etapa 5) |
| **Memoria con búsqueda** | **SQLite FTS5** (como Hermes) con `better-sqlite3` o el `node:sqlite` integrado | Dominio público (SQLite) | **Mem0** (Apache-2.0, ~48–60 k★, vectores), **Graphiti** (Apache-2.0, ~28 k★, grafo temporal), **Letta** (licencia **no verificada**, entorno completo) | **Adaptar**: FTS5 encima de los `.md` que ya existen; Mem0 o Graphiti son demasiado para un portátil |
| **Skills** (procedimientos reutilizables) | Formato **`SKILL.md`** (estándar agentskills.io, el mismo de Claude Code, OpenClaw y Hermes) | Estándar abierto | — | **Adaptar**: carpeta `%APPDATA%\orbe\skills\`; solo skills propias, **nunca de ClawHub** |
| **Aprendizaje de correcciones** | Proponer una skill o un recuerdo cuando corriges algo (como Hermes), **con tu aprobación** | — | — | **Construir** (Etapa 5) |
| **Proactividad (heartbeat)** | Turno periódico que lee un `PROACTIVO.md` y no gasta nada si está vacío (como OpenClaw) | — | — | **Construir** sobre las tareas que ya existen |
| **Activadores por evento** | Sondeo: `history` de Gmail y comentarios y mensajes de Instagram | API oficiales | Webhooks (exigen servidor público: **no aplica**) | **Construir** (Etapa 5) |
| **Subagentes** | Subagentes de Claude Code (`--agents` o `.claude/agents/`) llamados desde el CLI | Incluido en el CLI | OpenAI Agents SDK, Mastra, LangGraph (TS) | **Reutilizar** el CLI; un framework nuevo duplicaría lo que ya hace |
| **Navegador** | **Playwright MCP** (Apache-2.0) con Edge del sistema y perfil aparte | Mantenido (v0.0.79, ago-2026) | Browser Use (Python, autónomo), Stagehand (TS, ligado a Browserbase) | **Reutilizar** Playwright MCP y **construir** la lista de dominios bloqueados (Etapa 6) |
| **Voz: dictado** | **whisper.cpp** (MIT) o faster-whisper (int8 en CPU, algo más rápido) | Mantenidos | Dictado de Windows | **Reutilizar** |
| **Voz: habla** | **Kokoro-82M** (CPU, buena calidad) o **Piper** (más ligero) | Apache-2.0 / MIT | Google Cloud TTS (lo que prefieres; capa gratuita **no verificada**) | **Adaptar**: Orbe ya apunta a Kokoro en `localhost:8880` |
| **Modelo local de respaldo** | **Ollama** con Qwen3 4B o Gemma 3 4B (8 GB de RAM como mínimo; 16 GB, cómodo) | MIT | llama.cpp | **Reutilizar** solo como respaldo sin internet; con modelos de 4B, el uso de herramientas es poco fiable (*análisis propio*) |
| **APIs gratuitas de respaldo** | Gemini API: Flash Lite **~500 peticiones/día**; el Flash más nuevo solo **~20/día**; Pro fuera de la capa gratuita. **Groq**: 30 por minuto y 1.000–14.400 al día según el modelo. **OpenRouter** `:free`: 50 al día (1.000 tras pagar 10 $ una vez) | Cambian a menudo: **comprobar** en cada consola | — | **Reutilizar** con el proveedor OpenAI-compatible que ya existe |
| **MCP** | Especificación 2026-07-28 (fecha de ratificación **no verificada**); registro oficial `registry.modelcontextprotocol.io`; **MCP Apps** (interfaces dentro del chat) | Linux Foundation | — | **Reutilizar**; el registro es autodeclarado, así que hay que revisar cada servidor |

## 2.3 Qué **no** conviene

- **OpenClaw entero dentro de Orbe:** duplica lo que Orbe ya hace y arrastra su historial de seguridad. Conviene copiar
  **ideas** (heartbeat, skills), no código ni skills de ClawHub.
- **Ordenador en la nube por agente** (dots, Grok Bot, Manus): exige servidor y dinero. En Orbe, el equivalente es el
  propio portátil con la Etapa 6.
- **Webhooks** (dots, Cowork): necesitan una URL pública siempre encendida. Se sustituyen por sondeo mientras el portátil
  esté encendido.
- **Canales de mensajería** (WhatsApp, Telegram, Slack): no tienes teléfono, así que aportan poco por ahora. Opción
  futura: un resumen al correo, como borrador (*análisis propio*).

---

# FASE 3 · Tabla comparativa y recomendación

## 3.1 Comparativa por componente

| Componente | dots | Grok Bot | Copilot | Claude / Code | Codex | Gemini Agent | OpenClaw | Hermes | **Orbe hoy** |
|---|---|---|---|---|---|---|---|---|---|
| Dónde se ejecuta | Nube (PC propio) | Nube (1 PC/usuario) | Nube (Actions) + local | Local + nube | Local + nube | Nube | Local | Local | **Local (Windows)** |
| Revisión antes de actuar | Auto-review | Aprobaciones | PR humana | Permisos + hooks | Política de aprobación | Confirmación | Débil | — | Reglas, **sin revisor** |
| Memoria larga | Memoria ChatGPT | Por Bot + datos comunes | Por repo, con citas | CLAUDE.md + auto | AGENTS.md | Cuenta Google | Archivos | MD + FTS5 | `.md` **sin búsqueda** |
| Skills | Locales | De cuenta | Custom agents | SKILL.md | AGENTS.md | — | SKILL.md + ClawHub | Se crean solas | **No** |
| Subagentes | Space (**no verif.**) | Varios Bots | Agent HQ | Sí | Sí | Cadenas | Sí | Sí | **No** |
| Programado | Sí | Routines | Asíncrono | Cowork | Nube | Spark (**no verif.**) | Heartbeat | Sí | **Sí** |
| Por evento | Webhooks | Conectores | Issues/PR | — | — | — | Canales | — | **No** (Etapa 5) |
| Navegador | Propio en la nube | Pantallas | Playwright MCP | Chrome | — | Ex-Mariner | Sí | Sí | **No** (Etapa 6) |
| Secretos aparte de la memoria | Takeover | **Vault** | Secrets | — | — | Google | Débil | — | **Cofre DPAPI** ✔ |
| Coste mínimo | Pro | X/SuperGrok | Copilot de pago | Suscripción Claude | Plan ChatGPT | AI Ultra (**no verif.**) | 0 € + modelo | 0 € + modelo | **0 € + tu suscripción de Claude** |

## 3.2 Arquitectura recomendada para Orbe (continuación, sin servidor ni presupuesto)

Mantener la base actual (Electron + CLI de Claude + MCP de Orbe + cofre + `reglas.json`) y añadir, en este orden de
valor y coste:

1. **Revisor de riesgo (auto-review)**, como dots: antes de cualquier acción que no sea `libre`, Haiku compara la acción
   con tu orden y tus reglas; si no encaja, la para y te la explica. Ya previsto en la Etapa 5.
2. **Memoria con búsqueda FTS5**, como Hermes y Copilot: índice SQLite sobre recuerdos y conversaciones pasadas, con
   **cita del origen** de cada recuerdo (como Copilot) y caducidad de datos que cambian (como recomienda Grok Bot).
3. **Skills de Orbe (`SKILL.md`)**, como Claude Code y Hermes: procedimientos tuyos («cómo hago un carrusel de morfy»)
   que se cargan solo cuando hacen falta. Orbe **propone** una skill tras una corrección y tú la apruebas.
4. **Proactividad tipo heartbeat**, como OpenClaw y el «parte» de Atlas: un turno cada N minutos, solo con el portátil
   encendido, que lee `PROACTIVO.md` y no gasta tokens si no hay nada.
5. **Activadores por sondeo** (Gmail `history` e Instagram), en sustitución de los webhooks.
6. **Subagentes del CLI de Claude** para trabajos largos (investigar, redactar varias piezas) con contexto aislado y
   herramientas mínimas.
7. **Navegador propio con Playwright MCP** (Etapa 6), con las lecciones de Comet: `file://` bloqueado en el código,
   dominios sensibles bloqueados, el contenido web siempre como **datos**, y confirmación obligatoria al escribir o enviar.
8. **Voz local**: whisper.cpp + Kokoro o Piper; Google TTS como opción con adaptador.
9. **Respaldo gratuito**: Gemini Flash-Lite o Groq por el proveedor OpenAI-compatible; Ollama solo para charla sin
   internet.

## 3.3 Riesgos y limitaciones

| Riesgo | Por qué importa | Mitigación |
|---|---|---|
| **Inyección de instrucciones** (correos, comentarios, webs) | Afecta a todos: Comet, OpenClaw, y dots lo reconoce | Contenido externo como datos (ya hecho), revisor, confirmación humana para escribir o publicar, sin `file://` |
| **Skills de terceros** | 341 maliciosas en ClawHub | Solo skills propias, revisadas y sin código ejecutable |
| **Facturación del CLI de Claude** | El cambio anunciado del Agent SDK y `claude -p` (**no verificado** si se pausó) podría hacer de pago lo que hoy usa tu suscripción | Vigilar la página oficial; tener el respaldo de Gemini o Groq configurado |
| **Capas gratuitas que cambian** | Gemini bajó el Flash más nuevo a ~20 peticiones/día | No depender de una sola; registro de consumo (ya existe) |
| **Sin 24/7** | Sin servidor: nada corre con el portátil apagado | Asumido; las tareas se ponen al día al encender |
| **Hardware** | Modelos locales de 4B: lentos y con herramientas poco fiables | Solo como respaldo |
| **Políticas de Meta y Google** | Automatizar de más puede suspender cuentas | Publicar y responder siempre con aprobación (ya en `reglas.json`) |
| **Memoria que aprende sola** | Menos predecible (crítica a Hermes) | Todo aprendizaje como **propuesta** que apruebas |
| **Fuentes** | Muchas cifras vienen de terceros y cambian rápido | Marcadas «no verificado»; comprobar antes de construir cada etapa |

---

## Fuentes

**OpenAI dots**
- [OpenAI · Dots privacy, security, and safety FAQs](https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs)
- [OpenAI · Getting started with your dot](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot)
- [OpenAI · Scheduled tasks in ChatGPT](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)
- [OpenAI · Control your dot](https://learn.chatgpt.com/docs/dots/controls)
- [SiliconANGLE](https://siliconangle.com/2026/09/29/openai-launches-dots-always-on-ai-agents-in-chatgpt-with-their-own-cloud-computers/) · [TechCrunch](https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/) · [VentureBeat](https://venturebeat.com/technology/openai-launches-dots-always-on-ai-agent-coworkers-and-chatgpt-space-where-they-can-collaborate-with-human-teams) · [Flavio Copes](https://flaviocopes.com/openai-dots/)

**Grok Bot**
- [xAI · Introducing Grok Bot](https://x.ai/news/introducing-grok-bot) · [xAI · Changelog](https://x.ai/changelog/bot)
- [xAI · FAQ](https://docs.x.ai/grok-bot/faq) · [xAI · How Grok Bot works](https://docs.x.ai/grok-bot/how-grok-bot-works) · [Cursor · Work with Grok Bot](https://cursor.com/docs/grok-bot/work)
- [Unite.AI](https://www.unite.ai/xai-launches-grok-bot-always-on-ai-teammates-with-their-own-cloud-computers/) · [Flavio Copes](https://flaviocopes.com/grok-bot/)

**GitHub Copilot**
- [GitHub Docs · Firewall del agente](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall)
- [GitHub Docs · MCP y el agente](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/coding-agent/mcp-and-coding-agent)
- [GitHub Docs · Copilot Memory](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/copilot-memory)
- [GitHub Blog · Building an agentic memory system](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/)
- [GitHub Changelog · GitHub intelligence (28-oct-2026)](https://github.blog/changelog/2026-10-28-github-intelligence-puts-your-code-context-and-history-to-work)
- [GitHub Changelog · Copilot CLI](https://github.blog/changelog/2026-06-23-copilot-cli-new-terminal-interface-is-generally-available/) · [Help Net Security · Agent HQ](https://helpnetsecurity.com/2026/02/05/github-enables-coding-agents/)

**Claude**
- [Claude Code · Extend Claude Code](https://code.claude.com/docs/en/features-overview) · [Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude Help · Cowork](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile) · [Cowork changelog](https://claude.com/docs/cowork/changelog)
- [Developers Digest · Agent SDK 2026](https://www.developersdigest.tech/blog/claude-agent-sdk-whats-new-2026)

**Otros asistentes**
- [Codex · bucle del agente](https://codex.danielvaughan.com/2026/04/18/codex-cli-agent-loop-explained/) · [Guía de Codex](https://blakecrosley.com/guides/codex)
- [Project Mariner (Wikipedia)](https://en.wikipedia.org/wiki/Project_Mariner) · [Gemini Agent](https://learninggpt.ai/lessons/gemini/gemini-agent)
- [Manus · Wide Research](https://www.manus.im/blog/introducing-wide-research) · [The Register · Meta compra Manus](https://www.theregister.com/2025/12/30/meta_acquires_manus/)
- [Trail of Bits · auditoría de Comet](https://blog.trailofbits.com/2026/02/20/using-threat-modeling-and-prompt-injection-to-audit-comet/) · [Zenity Labs](https://labs.zenity.io/p/perplexedbrowser-perplexity-s-agent-browser-can-leak-your-personal-pc-local-files)
- [OpenClaw](https://openclaw.ai/) · [Turing Post · arquitectura](https://www.turingpost.com/p/openclaw) · [The Hacker News · 341 skills maliciosas](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html) · [Snyk · ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub)
- [Hermes Agent](https://agentic-ai.readthedocs.io/en/latest/AgentPlatforms/hermes-agent/)

**Recursos de código abierto y gratuitos**
- [Memoria: comparativa de código abierto](https://hindsight.vectorize.io/blog/2026/08/11/open-source-agent-memory-systems) · [Mem0 vs Zep](https://vectorize.io/articles/mem0-vs-zep)
- [Navegador: Browser Use, Stagehand, Playwright MCP](https://www.nxcode.io/resources/news/stagehand-vs-browser-use-vs-playwright-ai-browser-automation-2026)
- [Gemini API · capa gratuita (oct-2026)](https://imisofts.com/blog/gemini-api-free-tier-limits/) · [OpenRouter · APIs gratuitas](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/) · [Capas gratuitas](https://benchlm.ai/md/free-tier.md)
- [Ollama con 8 GB](https://webscraft.org/blog/ollama-na-8-gb-ram-yaki-modeli-pratsyuyut-u-2026?lang=en) · [Voz local: STT](https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026) · [Voz local: chat por voz](https://insiderllm.com/guides/voice-chat-local-llms-whisper-tts/)
- [MCP · release candidate 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) · [Repositorios de MCP](https://github.com/orgs/modelcontextprotocol/repositories)
- [Frameworks de agentes 2026](https://alexcloudstar.com/blog/ai-agent-frameworks-comparison-2026/)

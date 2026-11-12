# Catálogo de funciones agénticas (todo lo de la investigación, función por función)

> 12-nov-2026. Cruza cada función de los asistentes investigados ([INVESTIGACION-ASISTENTES.md](INVESTIGACION-ASISTENTES.md))
> con lo que Orbe ya tiene (v1.10.0, rama `claude/etapa-4-metricas`) y dice en qué etapa se construye lo que falta.
> Estado: ✔ hecho · ◐ parcial · ✗ falta · ⊘ descartado (con el motivo).

## 1. Núcleo del agente (cómo piensa y actúa)

| # | Función | Viene de | Orbe hoy | Etapa |
|---|---|---|---|---|
| N1 | Bucle de herramientas con límite de pasos | Todos | ✔ `agente/bucle.ts`, `ORBE_AGENTE_PASOS` | — |
| N2 | Permisos por acción en 4 niveles + bloqueado | dots (Custom Rules) | ✔ `reglas.json` | — |
| N3 | **Modo plan**: en tareas de varios pasos, primero un plan numerado que apruebas, luego ejecuta | Claude Code (plan mode), Gemini (reasoning chains), Codex | ✔ v1.13.0 (`proponer_plan`) | 6 |
| N4 | **Revisor antes de actuar** (auto-review): compara cada acción no libre con tu orden, tus reglas y la seguridad | dots | ✔ v1.13.0 (revisor determinista: tu orden y el contenido de fuera en cada tarjeta) | 6 |
| N5 | **Auto-comprobación** al terminar: verifica que el resultado existe y es correcto (el borrador se creó, el archivo pesa lo esperado) | Copilot (ejecuta pruebas antes de la PR) | ✔ v1.13.0 (instrucción al modelo) | 6 |
| N6 | Niveles de sensibilidad: «tú lo haces» (takeover), aprobación cada vez, aprobación previa «para esta tarea» | dots | ✔ v1.13.0 («Permitir en esta tarea», nunca para enviar/publicar/borrar) | 6 |
| N7 | **Pausar todo** (botón y atajo) y **monitor de seguridad** que pausa solo si detecta algo raro (bucle, muchas acciones seguidas, contenido sospechoso) | dots | ✔ v1.13.0 (Ctrl+Mayús+Retroceso, «Detener todo», vigilante de bucles, ráfagas y órdenes en contenido de fuera) | 6 |
| N8 | **Bandeja única de aprobaciones** (permisos, borradores, publicaciones pendientes) | Copilot (todo acaba en propuesta revisable), dots | ✔ v1.13.0 (los permisos de las tareas salen en la tarjeta del chat) | 6 |
| N9 | **Progreso visible en vivo** (paso actual, plan, qué herramienta usa) y resumen final | Grok Bot (pantallas), Manus | ✔ v1.13.0 (línea «Resumen: …» al terminar) | 6 |
| N10 | Lista de **dominios permitidos** para las herramientas web del agente (cortafuegos) | Copilot (firewall) | ✔ v1.13.0 (`ORBE_DOMINIOS`) | 6 |
| N11 | Compactar conversaciones largas (resumen automático) | Claude Code | ✔ v1.13.0 (API de Claude; el CLI compacta solo; OpenAI pendiente) | 6 |
| N12 | Contenido externo tratado como datos, nunca como órdenes | Lección de Comet y OpenClaw | ✔ `envoltorio.ts` | — |

## 2. Memoria y aprendizaje

| # | Función | Viene de | Orbe hoy | Etapa |
|---|---|---|---|---|
| M1 | Recuerdos en archivos y perfil del usuario | Hermes (`memory.md`, `user.md`), Claude (CLAUDE.md) | ✔ recuerdos `.md` | — |
| M2 | **Búsqueda** en recuerdos y en conversaciones pasadas (SQLite FTS5) con resumen | Hermes | ✔ v1.16.0 historial del chat · v1.17.0 índice FTS5 (`node:sqlite`) y `buscar_memoria` | 9 |
| M3 | **Origen** de cada recuerdo (de qué conversación o acción sale) | Copilot (citas) | ✔ v1.17.0 (`fuente`) | 9 |
| M4 | **Caducidad**: un recuerdo que no se usa en N días pierde peso o se archiva | Copilot | ✔ v1.18.0 (90 días, solo resumen) | 9 |
| M5 | **Comprobar antes de fiarse**: datos que cambian (precios, cifras) se vuelven a consultar | Grok Bot | ✔ v1.18.0 (prompt + aviso en `buscar_memoria`) | 9 |
| M6 | **Consolidación nocturna** («dreaming»): une duplicados, resume y propone limpiar | Copilot Memory | ✔ v1.18.0 (diaria, propone; el usuario acepta) | 9 |
| M7 | **Skills** propias (`SKILL.md`), cargadas solo cuando hacen falta | Claude Code, OpenClaw, Hermes | ✔ v1.19.0 (índice en prompt, `usar_skill`) | 9 |
| M8 | **Aprendizaje de correcciones**: tras corregir a Orbe, propone una skill o un recuerdo; la skill mejora al usarse | Hermes | ✔ v1.19.0 (`proponer_aprendizaje`, siempre con aprobación) | 9 |
| M9 | Memoria compartida entre chat y tareas | dots | ✔ | — |

## 3. Varios agentes

| # | Función | Viene de | Orbe hoy | Etapa |
|---|---|---|---|---|
| A1 | **Agentes con nombre y rol** (p. ej. «Contenido», «Correo», «Investigador», «Ventas»): instrucciones, herramientas permitidas, modelo y memoria propios; se ejecutan como subagentes nativos del CLI de Claude | Grok Bot (Bots), Copilot (custom agents), dots (varios dots) | ✗ | 10 |
| A2 | Datos comunes a todos los agentes (tu nombre, zona horaria, marcas) | Grok Bot | ✗ | 10 |
| A3 | **Rutinas por agente** con historial de ejecuciones (últimas 20) y topes | Grok Bot (Routines) | ◐ tareas con historial, sin agente | 10 |
| A4 | **Buzón entre agentes**: un agente deja un encargo a otro, que lo atiende y responde después | Grok Bot (mensajes asíncronos) | ✗ | 10 |
| A5 | **Subagentes en paralelo** con contexto aislado para trabajos largos: se **reutilizan los del CLI de Claude** (`--agents`) | Claude Code (subagents), Manus (Wide Research) | ✗ (solo se reciben avisos de subagentes de Claude Code) | 10 |
| A6 | Orquestador: Atlas/Orbe reparte el trabajo entre agentes | Grok Bot, dots Space | ✗ | 10 |

## 4. Proactividad y segundo plano

| # | Función | Viene de | Orbe hoy | Etapa |
|---|---|---|---|---|
| P1 | Tareas programadas con «solo si hay algo» | dots, Cowork | ✔ | — |
| P2 | **Heartbeat**: cada N min lee `PROACTIVO.md` y decide si actúa (sin gasto si está vacío) | OpenClaw | ✗ | 11 |
| P3 | **Activadores por evento** (por sondeo): correo nuevo, comentario o mensaje de Instagram, archivo nuevo en una carpeta, al encender el PC | dots (event triggers), Grok Bot | ✗ | 11 |
| P4 | **Investigación proactiva**: vigila temas que te interesan y te avisa con un resumen | dots | ✗ | 11 |
| P5 | **Ponerse al día al encender** (lo que no se pudo hacer con el portátil apagado) | Adaptación propia (sin 24/7) | ◐ | 11 |
| P6 | Parte de situación diario | Atlas | ✔ | — |
| P7 | Compañero proactivo que comenta lo que haces | Petición del usuario | ✗ | 14 |

## 5. Investigación profunda

| # | Función | Viene de | Orbe hoy | Etapa |
|---|---|---|---|---|
| R1 | **Modo «Investigar a fondo»**: plan de búsqueda → varias búsquedas → lectura de fuentes → informe con citas | Gemini (Deep Research), dots, Manus | ◐ búsqueda web + lectura de páginas (WebFetch del CLI, v1.14.0) | 12 |
| R2 | Subtemas investigados en paralelo por subagentes | Manus (Wide Research) | ✗ | 12 |
| R3 | Informe guardado en `data/<usuario>/informes/` y retomable | Claude, Manus | ✗ | 12 |

## 6. Herramientas e integraciones

| # | Función | Viene de | Orbe hoy | Etapa |
|---|---|---|---|---|
| H1 | Gmail (leer, borradores) | dots, Gemini | ✔ Etapa 1 | — |
| H2 | Instagram (leer, métricas) | — | ✔ Etapas 2 y 4 | — |
| H3 | **Miles de apps** por un solo conector | dots (4.000+ apps), Grok Bot (connectors) | ✔ v1.12.0 | 5 (Composio) |
| H4 | MCP como servidor y como cliente | Claude, Copilot | ✔ v1.12.0 (servidor propio + cliente de Composio) | 5 |
| H5 | **Navegador propio** del agente con perfil aparte | dots, Grok Bot, Comet, Claude in Chrome | ✗ | 15 |
| H6 | Si una web pide iniciar sesión, ofrecer el conector o pasarte el control | Grok Bot | ✗ | 15 |
| H7 | **Visión** (entender imágenes) opcional | Todos | ✗ | 13 |
| H8 | Publicación en Instagram | Plan propio | ✗ aparte por decisión del usuario | — |
| H9 | **Google ampliado**: Calendar, Drive, Docs, Sheets, Tasks, Contactos, YouTube y envío de Gmail opcional, con permisos incrementales | dots, Gemini (apps de Google) | ⊘ el usuario conecta Drive, Calendar y demás por Composio (12-nov); la Etapa 7 quedó en buscador ampliado | — |
| H10 | **Control del PC**: ver la ventana como lista de elementos, pulsar, escribir, teclas y ratón, con «Muéstrame cómo» y «Hazlo tú» | Claude (computer use), dots, Manus | ✔ v1.15.0 · v1.15.1 `ver_pagina`, `pc_mirar` (imagen de la ventana y clic sobre ella) y modo auto | 8 |

## 7. Interfaz y canales

| # | Función | Viene de | Orbe hoy | Etapa |
|---|---|---|---|---|
| I1 | Avatar con presencia (conejo, Atlas) | dots | ✔ | — |
| I2 | Voz: dictado y respuesta hablada | dots (llamada), Gemini | ◐ voz de Windows; neuronal aplazada | 17 |
| I3 | **Conversación por voz manos libres** (como una llamada) | dots | ✗ | 17 |
| I4 | Chatear tú con Atlas por WhatsApp, Telegram, Slack o Teams | dots, OpenClaw | ⊘ sin teléfono; además Meta prohíbe los asistentes de IA generales en la API de WhatsApp desde el 15-ene-2026 | — |
| I7 | **WhatsApp de la marca** atendido con Atlas: clientes escriben, Atlas resume y redacta, tú apruebas cada respuesta | Petición del usuario (12-nov) | ⊘ aplazado por decisión del usuario (12-nov); diseño guardado en WHATSAPP-GOOGLE-PC.md §2 | — |
| I5 | Ordenador en la nube que trabaja 24/7 | dots, Grok Bot, Manus | ⊘ excluido desde el principio («excepto 24/7»), sin servidor | — |
| I6 | Interfaces dentro del chat (MCP Apps) | Claude | ⊘ más adelante | — |

## 8. Seguridad y control

| # | Función | Viene de | Orbe hoy | Etapa |
|---|---|---|---|---|
| S1 | Secretos aparte de la memoria (cofre/Vault) | Grok Bot (Vault) | ✔ cofre DPAPI | — |
| S2 | Registro de actividad con secretos tachados | Copilot, dots | ✔ | — |
| S3 | Solo skills propias; nada de catálogos de terceros | Lección de OpenClaw (341 maliciosas) | — | 9 |
| S4 | `file://` bloqueado en el código del navegador; dominios sensibles bloqueados | Lección de Comet | — | 15 |
| S5 | Consentimiento explícito para lo que sale del PC (visión) | Decisión del 12-nov | — | 13 |
| S6 | Exportar y borrar todos mis datos | Petición del usuario (otras personas) | ✗ | 16 |

## Resumen

- 60 funciones: **hechas** 12 · **parciales** 13 · **faltan** 28 · **descartadas o aplazadas con motivo** 4 · **reglas de
  seguridad nuevas** 3 (S3–S5).
- Las que faltan están repartidas en las Etapas 5 a 17 del [prompt de construcción](PROMPT-CONSTRUCCION.md).
- WhatsApp, Google ampliado, control del PC y subagentes nativos: [WHATSAPP-GOOGLE-PC.md](WHATSAPP-GOOGLE-PC.md).

# Orbe · contexto para Claude Code

Este archivo lo lee Claude Code automáticamente al abrir el repositorio. Es la fuente de verdad del proyecto: si algo
de aquí contradice a tu memoria, manda este archivo.

## Quién es el usuario y cómo trabajar con él

- Estudiante de 11.º grado y emprendedor (marcas **J&S Design** y **morfy**, más su **marca personal**). Un solo
  portátil con Windows, **sin teléfono**, sin servidor ni presupuesto: todo funciona solo mientras el portátil está encendido.
- Responde **siempre en español**, con tono formal y directo, sin relleno ni frases motivacionales.
- Trabaja **por fases y con aprobación escrita**: investigación → plan → borrador → construcción. No avances de fase sin
  un «apruebo» explícito. Si falta información clave, haz **como máximo 3 preguntas**.
- Cita fuentes oficiales y marca como **«no verificado»** lo que no puedas comprobar.
- **Nunca pidas ni muestres contraseñas, tokens ni claves en el chat.** Indica cómo guardarlos (Ajustes de Orbe →
  cofre cifrado, o `.env`). Si ves una clave en un archivo, di «hay una clave guardada», nunca su valor.
- Respeta las políticas de Meta y Google: nada de automatizaciones que puedan suspender sus cuentas (seguir, dar me
  gusta, comentar en cuentas ajenas, scraping de Instagram, envíos masivos). Publicar y responder **siempre con su aprobación**.

## Qué es Orbe

Asistente de escritorio para Windows (Electron 44 + electron-vite + TypeScript). Un conejo 3D (three.js) vive en una
esquina, siempre encima; al hacer doble clic en su centro se abre el panel de chat. Habla con Claude por el **CLI de
Claude** (por defecto, con la suscripción del usuario), por la API de Anthropic o por cualquier API compatible con
OpenAI (Gemini, Groq…). Tiene memoria, lectura de pantalla, OCR, voz, modo agente con permisos, **tareas de fondo**
(réplica local de ChatGPT «dots»), registro de **consumo**, avisos de Claude Code por hooks y la identidad **Atlas**.

Versión actual: ver `package.json`. Historial de versiones en las releases de GitHub.

## Mapa del código

| Carpeta | Qué hay |
|---|---|
| `src/main/` | Proceso principal: ventana, bandeja, configuración (`entorno.ts`, `configuracion.ts`), humo (`humo.ts`) |
| `src/main/chat/` | Proveedores (`proveedor-cli.ts`, `-api.ts`, `-openai.ts`), `prompt-sistema.ts`, `fabrica.ts` |
| `src/main/cofre/` | Cofre cifrado (`cofre.bin`, `safeStorage`): `cofre.ts`, `ipc.ts` (estado/guardar/borrar, sin lectura), `electron.ts`. Lista cerrada de secretos en `src/shared/cofre.ts` |
| `src/main/agente/` | Modo agente: herramientas (`herramientas/`), `politica.ts` (permisos), `reglas.ts` (`reglas.json`, 4 niveles + mínimos fijos), `servidor-mcp.ts` (el CLI usa las herramientas de Orbe por MCP como `mcp__orbe__*`), `envoltorio.ts` (contenido externo = datos) |
| `src/main/tareas/` | Tareas de fondo: programación, cola, permisos, notificaciones |
| `src/main/uso/` | Registro de consumo y tarifas |
| `src/main/memoria/` | Memoria del usuario y detección de secretos (`secretos.ts`) |
| `src/main/conectores/` | Receptor local de avisos (Claude Code, scripts). `gmail/`: `oauth.ts` (loopback + PKCE) y `cliente.ts` (buscar, leer, borradores; sin enviar) |
| `src/shared/` | Tipos y lógica común (`tipos.ts`, `identidad.ts`, `tareas.ts`…) |
| `src/renderer/` | Interfaz: `chat/panel.ts`, `ajustes/`, `tareas/`, `uso/`, `personaje/` (3D, gestos), `estilos.css` |
| `tests/` | Pruebas vitest |
| `docs/fase3-borradores/` | **Plan y borradores aprobados** de conectores (Gmail, Instagram, Supabase, Claude Design, navegador) |
| `docs/IDENTIDAD-ATLAS.md` | Diseño de la identidad Atlas |

Convenciones: código, nombres y textos **en español**; comentarios que explican el porqué; nada de SDKs pesados si
basta `fetch`; toda herramienta del agente valida su entrada (`validacion.ts`) y declara su nivel de permiso; lo que
llega de fuera (webs, correos, comentarios) se envuelve como datos, nunca como instrucciones.

## Órdenes

```
npm ci                 # dependencias
npm run dev            # Orbe en modo desarrollo
npm run typecheck      # tipos (main y renderer)
npm test               # vitest
npm run humo           # prueba de humo: arranca Orbe en modo demo, recorre la interfaz y guarda capturas en humo/
npm run dist           # instaladores de Windows en dist/
```

Antes de dar algo por terminado: `npm run typecheck`, `npm test` y, si tocas la interfaz, `npm run humo` (revisa las
capturas de `humo/`). Fallos conocidos que no son tuyos: en Linux, 2 pruebas de `buscarRutaCli`/aplicaciones; en la
prueba de humo, «control de visibilidad», «Esc corta la voz», «voz de Windows» y a veces «pensando pone cara».

## Git, pull requests y versiones

- Trabaja en una rama (`claude/<tema>`), nunca directamente en `main`. Abre la pull request como borrador; **el usuario
  la fusiona**. Si su PR ya se fusionó, la siguiente tarea empieza en una rama nueva desde `main`.
- Cada entrega que el usuario vaya a instalar sube la versión en `package.json` (`npm version X.Y.Z --no-git-tag-version`).
- Release: pestaña Actions → «Publicar instalador» → Run workflow sobre la rama, o `gh workflow run release.yml --ref <rama>`.
  Publica `Orbe-Setup`, `Orbe-Portable`, el `.zip` y `Orbe-herramientas` con la versión de `package.json`.

## Estado y siguiente trabajo (Fase 4, aprobada)

Hecho: v1.4.x (barra lateral, tareas tipo dots, consumo, gestos), v1.5.0 (Atlas), v1.5.1 (arreglo de Configuración),
v1.6.0 (**Etapa 0, Seguridad**: cofre cifrado, `reglas.json`, Ajustes → Conectores, tachado de secretos en Actividad).

v1.7.0 (**Etapa 1, Gmail**: OAuth de escritorio, `gmail_buscar`, `gmail_leer`, `gmail_borrador`, botón Conectar).

Cómo se añade un conector (molde de las Etapas 0 y 1): el cliente del servicio va en `src/main/conectores/<servicio>/` y
recibe `fetch` inyectable para las pruebas; sus herramientas van en `src/main/agente/herramientas/<servicio>.ts`, declaran
`accion` (p. ej. `gmail.borrador`) y devuelven `externo` para lo que venga de fuera; se crean en `src/main/index.ts` y se
pasan a `crearRegistro(config, sistema, conectores)`. Los secretos se leen con `cofre.leer()` en el proceso principal.
`Politica` recibe la orden del usuario (`entrada.texto`, sin contexto de pantalla) para decidir `si_lo_pediste`.

Decisiones de la Etapa 1: no hay variables `ORBE_GMAIL*`; Gmail se ofrece si existe `%APPDATA%\orbe\google-cliente.json`.
El aviso de correos nuevos por sondeo (`history`) queda para la Etapa 5. Fallo intermitente conocido bajo carga:
`agente-proveedor-cli.test.ts` «una herramienta lenta… no cuentan como un CLI colgado» (pasa en solitario).

v1.8.0 (**Etapa 2, Instagram lectura**: `ig_perfil`, `ig_publicaciones`, `ig_metricas`, `ig_comentarios`, todas `ig.leer`).

Decisiones de la Etapa 2: la versión de la API es una constante (`VERSION_API` en `conectores/instagram/cliente.ts`), no
una variable; las herramientas se ofrecen siempre y sin token dicen dónde guardarlo; el token (`ig.<cuenta>`, con fecha)
se renueva solo a los 30 días al usarlo. Las ventanas falsas de las pruebas de IPC no tienen `isDestroyed`: la guarda de
ventana destruida solo está en `ventana.ts`. En `npm run dev`, «Guardar» de Ajustes escribe el `.env` del repositorio y
relanza Orbe sin servidor de interfaz: hay que volver a ejecutar `npm run dev`. Con el equipo cargado, `npm test` da
tiempos agotados sueltos; `npx vitest run --no-file-parallelism` es la referencia.

**En curso (10-nov-2026), retomar aquí.** Etapa 1: PR #15 en borrador sin fusionar, release v1.7.0 publicada. Etapa 2:
código, pruebas y documentación hechos en `claude/etapa-2-instagram` (sale de `claude/etapa-1-gmail`), **PR #16 en borrador
y release v1.8.0 publicada** a petición del usuario, con la prueba real de métricas aún pendiente. La app de Meta del usuario usa la API de Instagram con **inicio de sesión
unificado** (token `EAA…` de usuario del sistema, `graph.facebook.com`, cuenta por id desde
`/me/assigned_instagram_accounts`); el conector acepta esa variante y la de inicio de sesión de Instagram
(`graph.instagram.com`, `/me`), eligiendo por el prefijo del token. Probado con sus tokens reales: perfil, publicaciones y
comentarios funcionan (token por cabecera `Authorization` incluido). Falta: las métricas dan error 10 porque al token le
falta `instagram_manage_insights`; el usuario debe añadirlo y generar el token de nuevo, y entonces comprobar métricas de
carruseles. Además `ig.morfy` e `ig.personal` guardan el mismo token y los dos ven solo `@josias.segura` (su marca
personal): la fila de morfy necesita un token con la cuenta de morfy. Cuando las métricas pasen: PR en borrador +
`gh workflow run release.yml --ref claude/etapa-2-instagram`. La v1.8.0 instalada en su PC se compiló en local desde esta
rama (`npm run dist` + `dist\Orbe-Setup-1.8.0.exe /S /allusers`). Sin verificar: la variante de inicio de sesión de
Instagram contra Meta real (solo con pruebas) y cuándo caduca su token `EAA…`. Voz neuronal: **aplazada** a una fase
posterior; el usuario la quiere con **Google** (ya no ElevenLabs). Hoy apunta a un Kokoro local en `localhost:8880` que no
está en marcha y cae a la voz de Windows; Google Cloud Text-to-Speech no es compatible con `/audio/speech` de OpenAI
(no verificado si hay pasarela compatible): hará falta un adaptador. Dictado: abrir el
micrófono tarda ~4 s en su PC; hay estado `preparando` para que un segundo clic no duplique la grabación. Idea sustituida por la Etapa 5 (Composio):
dejar pasar al CLI una lista cerrada de conectores de claude.ai (Zapier, Calendar…) clasificados en `reglas.json`; hoy
`proveedor-cli.ts` los bloquea con `--strict-mcp-config`. Sitio web: https://orbe-olive.vercel.app/ (rama `claude/sitio-web`).

v1.9.0 (**Etapa 3, Contenido**, rama `claude/etapa-3-contenido`, sale de `claude/etapa-2-instagram`): pestaña
«Contenido», `contenido/contenido.json`, fichas `marcas/<marca>/marca.md`, herramientas libres `contenido_ficha_marca` y
`contenido_proponer` (sin acción de conector: solo local). Decisiones: el PNG se une a su pieza por el **nombre**
(`<id>.png`, `<id>-N.png`), que dicta el encargo de «Diseñar»; sin vigilante de carpeta: la pestaña abierta mira la
entrada cada 4 s; un archivo modificado hace menos de 2 s no se toca; los que no valen se quedan con aviso; borrar mueve a
`papelera/`. Aplazado del borrador: el diseñador automático por CLI (`contenido_guardar_diseno`, modo «exportado»).
HTML → PNG siempre a 1080×1350. Sin verificar: que Claude Design ofrezca exportar PNG en la cuenta del usuario. **En espera por decisión del usuario (11-nov-2026)**: diseño
automático (CLI de Claude escribe el HTML y genera la foto con el conector MCP de Higgsfield de su cuenta de Claude;
render por CDP a 1080×1350 exactos). Está en la rama `claude/etapa-3-disenador-auto`, sin fusionar. Verificado: el CLI
ve el conector solo con `ENABLE_TOOL_SEARCH=true`, `ToolSearch` y sin `--strict-mcp-config` (sin eso, «Prompt is too
long»). Pendiente si se retoma: humo tras el render por CDP y una prueba real con foto (gasta créditos). Nota: el render
del PR actual usa `capturePage`, que con el escalado de Windows al 150 % sale desplazado; el respaldo HTML → PNG del PR
#17 tiene ese fallo (el arreglo por CDP está en la rama en espera).

v1.10.0 (**Etapa 4, Métricas y crecimiento**, rama `claude/etapa-4-metricas`, sale de `claude/etapa-3-contenido`): por
decisión del usuario (11-nov-2026) la **Publicación queda aparte** y esta etapa ocupa su lugar. Pestaña «Métricas»,
`metricas/servicio.ts` (12 publicaciones, medias, tasa = interacciones/alcance, o /seguidores sin alcance), historial
diario en `metricas.json` (foto automática cada 6 h si no hay una de hoy y la cuenta tiene token), herramienta
`ig_crecimiento` (`ig.leer`), «Analizar con Claude» manda un encargo al chat (no hay llamada aparte al modelo) y
plantilla de tarea semanal. En la prueba de humo, Instagram es `metricas/demo.ts`. Prueba real pendiente del permiso
`instagram_manage_insights`.

v1.11.0 (**Etapa 4b, interfaz**, rama `claude/etapa-8-interfaz`, sale de `claude/etapa-4-metricas`): fuera J&S Design
(`CUENTAS` = morfy y personal; el token `ig.jsdesign` sigue en el cofre sin borrar, solo deja de mostrarse) y fuera la
pestaña Contenido (código borrado; `%APPDATA%\orbe\contenido` intacto). Uso, Memoria, Voz y Fondo salen de la barra
lateral: sus botones siguen en `#carril` con `hidden` (los menús y atajos los usan) y se abren desde la lista de
Configuración (`APARTES` en `vista-ajustes.ts`). Iconos SVG propios en `crearIcono` en lugar de emojis. Fondo:
«Elegir imagen…» (`fondoElegir`, diálogo del sistema; `ServicioFondos.elegir` copia a `datos/fondos`, `carpetaPropia`).

v1.12.0 (**Etapa 5, Composio**, rama `claude/etapa-5-composio`): cliente MCP propio con `fetch`
(`conectores/composio/cliente.ts`, `x-consumer-api-key` desde el cofre `composio.clave`, acepta JSON y SSE) y tres
herramientas (`composio_buscar`, `composio_conectar`, `composio_ejecutar`). `Herramienta.accionDe(entrada)` deja que la
acción dependa de la entrada: `clasificar.ts` da `composio.leer` (libre) o `composio.escribir` (mínimo «preguntar»).
Por decisión del usuario (12-nov-2026) nada de Composio está bloqueado: enviar, publicar, borrar y las apps de
Gmail/Meta van por «preguntar». `modoDe` usa `REGLAS_POR_DEFECTO` para acciones que falten en un `reglas.json` antiguo.

v1.12.1: el conejo 3D incluido pasa a ser `conejo-con-pelo.glb` (de `orbe-sitio`, 26 MB, 1,1 M triángulos,
piel y pelo; su animación no se reproduce). El humo espera a que la figura deje de estar «cargando».

v1.13.0 (Etapa 6, núcleo agéntico N3–N11): `proponer_plan` (`herramientas/plan.ts`, siempre se aprueba aparte);
`Politica` añade `preaprobar` (respuesta `'tarea'` = «Permitir en esta tarea», `RespuestaPermiso = boolean | 'tarea'`
por IPC; nunca si la acción o el título casan con `ENVIO`, si es peligrosa o en modo vigilado), `leyoExterno` y el
revisor (`revision` en la tarjeta: la orden y el contenido de fuera leído). `EjecutorHerramientas` lleva el vigilante
(misma llamada 3 veces o 12 en 60 s → tarjeta «¿Sigo?»; texto de fuera con órdenes → `vigilar()`). «Detener todo»:
atajo `ORBE_ATAJO_PAUSA` (por defecto `CommandOrControl+Shift+Backspace`) y la bandeja; `ServicioTareas.cancelarTodo`.
Los permisos de tareas salen en la tarjeta del chat (`panel.permisoDeTarea`; cerrarla sin responder no cuenta como no).
`ServicioChat` emite «Resumen: …» al final si hubo 2+ acciones. `ORBE_DOMINIOS` limita `abrir_url`. `chat/compactar.ts`
resume la mitad antigua del historial de la API por encima de 240 000 caracteres. Sin pantalla de bienvenida en el chat.

v1.14.0 (Etapa 7, reducida por decisión del usuario a «buscador ampliado»; Google ampliado va por Composio):
con el proveedor CLI, `--tools` es `WebSearch,WebFetch`; `WebFetch` se permite con `WebFetch(domain:…)` por cada
dominio de `ORBE_DOMINIOS` (o entero si la lista está vacía; que cubra subdominios no está verificado). En el chat
sale como «Leyendo: url» (`leer_web`) y su resultado es texto de fuera.

v1.15.0 (Etapa 8, control del PC H10): `helper/UiaHelper.cs` gana la clase `Control` (ops `elementos`, `actuar`,
`ventanas`, `enfocar`, `punto`, `clic`, `teclas`, `texto`, `vigilar`), se declara DPI-aware (píxeles físicos) y con
ganchos de bajo nivel avisa `{"tipo":"usuario"}` (lo simulado va marcado como inyectado y se ignora; lo hecho en la
ventana de Orbe no cuenta salvo Esc) → `ClienteHelper.alEvento` → `ControlPc.usuarioIntervino` → `detenerTodo`.
Nunca escribe en campos de contraseña o código (lo comprueba el C#). `src/main/pc/control.ts`: `motivoBloqueo`,
`CON_EFECTO`, `parsearTeclas` (sin tecla Windows), tope de 40 acciones, sesión con borde (`pc/marco.ts`, ventana
transparente sin foco ni clics, `setContentProtection`). Herramientas en `agente/herramientas/pc.ts`; acción por app
`pc_<proceso>.ver|control`, que sin regla propia cae en `pc.ver` (libre) / `pc.control` (preguntar) (`modoDe`).
Solo con el helper real (no en humo).

v1.15.1: `ver_pagina` (texto de la ventana/página abierta, op `contenido`, externo); `abrir_aplicacion` espera hasta
10 s la ventana (`LanzadorApps.ventanas`). Modo auto: rayo `#auto-boton` → IPC `auto:info|fijar` (`modo-auto.ts`,
guardado en `ajustes.json` `auto`); `Politica({auto})` permite todo salvo `prohibir` y modo vigilado; en `pc.ts`
`confirmar` solo pregunta si `PAGO`; Enter ya no es tecla con efecto. `pc_mirar`: `pc/captura-ventana.ts`
(desktopCapturer, recorte, JPEG ≤1280 en memoria) → `ResultadoEjecucion.imagen` → bloque de imagen MCP (CLI) o en
`tool_result` (API; las rondas viejas se omiten); OpenAI no la recibe. `pc_clic` con `imagen: true` pasa píxeles de
la imagen a pantalla (`ControlPc.enPantalla`). No tocar `setContentProtection` de la ventana de Orbe: la dejaba sin
dibujar.

El plan vigente es el de `docs/investigacion/PROMPT-CONSTRUCCION.md` (Etapas 5–17; la web solo cuando el usuario diga
«web»): 6 núcleo agéntico · 7 Google ampliado · 8 control del PC · 9 datos y memoria · 10 subagentes del CLI ·
11 proactividad · 12 investigación profunda · 13 visión · 14 compañero local · 15 navegador · 16 Orbe para otras
personas · 17 voz. Lo de abajo queda como referencia histórica.

Pendiente antiguo (detalle, código en borrador y prompts en `docs/fase3-borradores/`):

4. **Publicación** (aparte por decisión del usuario; no se hace hasta que lo pida): aprobación → Supabase Storage (bucket privado, enlace firmado de 15 min) → Meta → borrar de Supabase.
5. Hecha en v1.12.0 (ver arriba). Nota original: **Composio** (pedido por el usuario el 11-nov-2026, para tener muchos conectores sin programarlos uno a uno):
   Orbe como cliente MCP de `https://connect.composio.dev/mcp` (clave en la cabecera `x-consumer-api-key`, guardada en
   el cofre como `composio.clave`; fuente: https://docs.composio.dev/docs/composio-connect.md). Composio expone 7
   meta-herramientas (`COMPOSIO_SEARCH_TOOLS`, `…_GET_TOOL_SCHEMAS`, `…_MULTI_EXECUTE_TOOL`, `…_MANAGE_CONNECTIONS`,
   `…_WAIT_FOR_CONNECTIONS`, `…_REMOTE_WORKBENCH`, `…_REMOTE_BASH_TOOL`), así que **no se pasan tal cual**: Orbe ofrece
   sus propias herramientas `composio_buscar` y `composio_ejecutar`, y clasifica cada acción por su nombre en
   `reglas.json` (`composio.leer` libre para GET/LIST/FETCH/SEARCH; el resto «preguntar»; enviar correos, publicar,
   pagos y borrar, prohibidos como hoy). `REMOTE_WORKBENCH` y `REMOTE_BASH_TOOL` bloqueados siempre. Meta/Instagram,
   Gmail y Claude siguen con los conectores propios (decisión del usuario); en Composio se bloquean. Conectar cada app
   lo hace el usuario por OAuth en su navegador. Sin verificar: precios/plan gratuito y si la clave «consumer» se
   genera en «AI Clients» del panel de Composio. Sustituye a la idea de dejar pasar conectores de claude.ai al CLI.
6. **Funciones tipo dots**: revisor de riesgo, activadores por sondeo, aprendizaje de correcciones.
7. **Navegador propio**: Playwright con Edge del sistema y perfil aparte; Meta, Google y bancos bloqueados.
8. Hecha en v1.11.0 como «Etapa 4b» (ver arriba).

Cada etapa: código + pruebas + humo + versión nueva + PR + release, y una guía para que el usuario la pruebe con sus
cuentas reales. No conectes cuentas reales tú mismo: el usuario genera los tokens y los guarda en Orbe.

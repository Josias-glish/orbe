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
código, pruebas y documentación hechos en `claude/etapa-2-instagram` (sale de `claude/etapa-1-gmail`), subida **sin PR ni
release** porque la prueba real está a medias. La app de Meta del usuario usa la API de Instagram con **inicio de sesión
unificado** (token `EAA…` de usuario del sistema, `graph.facebook.com`, cuenta por id desde
`/me/assigned_instagram_accounts`); el conector acepta esa variante y la de inicio de sesión de Instagram
(`graph.instagram.com`, `/me`), eligiendo por el prefijo del token. Probado con sus tokens reales: perfil, publicaciones y
comentarios funcionan (token por cabecera `Authorization` incluido). Falta: las métricas dan error 10 porque al token le
falta `instagram_manage_insights`; el usuario debe añadirlo y generar el token de nuevo, y entonces comprobar métricas de
carruseles. Además `ig.morfy` e `ig.personal` guardan el mismo token y los dos ven solo `@josias.segura` (su marca
personal): la fila de morfy necesita un token con la cuenta de morfy. Cuando las métricas pasen: PR en borrador +
`gh workflow run release.yml --ref claude/etapa-2-instagram`. La v1.8.0 instalada en su PC se compiló en local desde esta
rama (`npm run dist` + `dist\Orbe-Setup-1.8.0.exe /S /allusers`). Sin verificar: la variante de inicio de sesión de
Instagram contra Meta real (solo con pruebas) y cuándo caduca su token `EAA…`. Idea pendiente de aprobación (no es parte del plan):
dejar pasar al CLI una lista cerrada de conectores de claude.ai (Zapier, Calendar…) clasificados en `reglas.json`; hoy
`proveedor-cli.ts` los bloquea con `--strict-mcp-config`. Sitio web: https://orbe-olive.vercel.app/ (rama `claude/sitio-web`).

Pendiente, en este orden (detalle, código en borrador y prompts en `docs/fase3-borradores/`):

3. **Contenido**: pestaña «Contenido»; textos con el CLI de Claude; diseños **exportados en PNG desde Claude Design**
   a `%APPDATA%\orbe\contenido\entrada\<marca>\` (respaldo: HTML → PNG en ventana oculta sin red). Marcas: jsdesign, morfy, personal.
4. **Publicación**: aprobación → Supabase Storage (bucket privado, enlace firmado de 15 min) → Meta → borrar de Supabase.
5. **Funciones tipo dots**: revisor de riesgo, activadores por sondeo, aprendizaje de correcciones.
6. **Navegador propio**: Playwright con Edge del sistema y perfil aparte; Meta, Google y bancos bloqueados.

Cada etapa: código + pruebas + humo + versión nueva + PR + release, y una guía para que el usuario la pruebe con sus
cuentas reales. No conectes cuentas reales tú mismo: el usuario genera los tokens y los guarda en Orbe.

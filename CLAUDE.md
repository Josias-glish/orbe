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
| `src/main/agente/` | Modo agente: herramientas (`herramientas/`), `politica.ts` (permisos), `servidor-mcp.ts` (el CLI usa las herramientas de Orbe por MCP como `mcp__orbe__*`), `envoltorio.ts` (contenido externo = datos) |
| `src/main/tareas/` | Tareas de fondo: programación, cola, permisos, notificaciones |
| `src/main/uso/` | Registro de consumo y tarifas |
| `src/main/memoria/` | Memoria del usuario y detección de secretos (`secretos.ts`) |
| `src/main/conectores/` | Receptor local de avisos (Claude Code, scripts) |
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

Hecho: v1.4.x (barra lateral, tareas tipo dots, consumo, gestos), v1.5.0 (Atlas), v1.5.1 (arreglo de Configuración).

Pendiente, en este orden (detalle, código en borrador y prompts en `docs/fase3-borradores/`):

0. **Seguridad**: cofre cifrado con `safeStorage` (`cofre.bin`), reglas de permisos en 4 niveles (`reglas.json`) y
   pantalla Ajustes → Conectores para guardar secretos sin mostrarlos nunca.
1. **Gmail**: API de Gmail con OAuth de escritorio (loopback 127.0.0.1 + PKCE), solo `gmail.readonly` y `gmail.compose`.
2. **Instagram (lectura)**: API de Instagram con inicio de sesión de Instagram, Standard Access, sin revisión de Meta.
3. **Contenido**: pestaña «Contenido»; textos con el CLI de Claude; diseños **exportados en PNG desde Claude Design**
   a `%APPDATA%\orbe\contenido\entrada\<marca>\` (respaldo: HTML → PNG en ventana oculta sin red). Marcas: jsdesign, morfy, personal.
4. **Publicación**: aprobación → Supabase Storage (bucket privado, enlace firmado de 15 min) → Meta → borrar de Supabase.
5. **Funciones tipo dots**: revisor de riesgo, activadores por sondeo, aprendizaje de correcciones.
6. **Navegador propio**: Playwright con Edge del sistema y perfil aparte; Meta, Google y bancos bloqueados.

Cada etapa: código + pruebas + humo + versión nueva + PR + release, y una guía para que el usuario la pruebe con sus
cuentas reales. No conectes cuentas reales tú mismo: el usuario genera los tokens y los guarda en Orbe.

# Orbe

Asistente de escritorio flotante para Windows 11. Un orbe fluido (shaders WebGL) siempre visible en una esquina que se abre como panel de chat con Claude y, solo cuando se lo pides, entiende lo que tienes en pantalla.

> Estado: **fase 2 de 5** (chat con Claude). El contexto de pantalla (fase 3), la captura de respaldo (fase 4) y la bandeja del sistema (fase 5) llegan después.

## Requisitos
- Windows 11
- Node.js 22.12 o superior (probado con 24)
- Una de estas dos formas de hablar con Claude:
  - **El CLI de Claude** instalado y con la sesión iniciada (`npm install -g @anthropic-ai/claude-code`, luego `claude` y `/login`). Usa tu plan de Claude, sin API key. Es la opción por defecto.
  - **Una API key** de Anthropic en el archivo `.env`.

## Instalación
```bash
npm install
```
La primera vez que se ejecuta, Electron descarga su binario (unos 100 MB).

Para configurar Orbe, copia `.env.example` como `.env` y cambia lo que quieras (todo es opcional; sin `.env` funciona con el CLI de Claude y Sonnet 5.5).

## Uso
```bash
npm run dev         # desarrollo, con recarga en caliente
npm run build       # compila a out/
npm run start       # ejecuta la versión compilada
npm test            # pruebas unitarias
npm run humo        # prueba de humo con un chat de mentira; guarda capturas en humo/
npm run humo:real   # igual, pero conversando de verdad con Claude (gasta unos céntimos)
```

## Controles
- **Clic** en el orbe: abrir o cerrar el panel. **Esc** también lo cierra.
- **Arrastrar** el orbe (o la cabecera del panel): moverlo. Recuerda su última posición.
- **Ctrl + Mayús + Espacio**: abrir o cerrar el panel desde cualquier aplicación.
- **Enter** envía el mensaje; **Mayús + Enter** hace un salto de línea.
- El botón de enviar se convierte en **Detener** mientras Claude responde.
- El lápiz de la cabecera empieza una **conversación nueva** (Claude olvida la anterior).
- Con `npm run dev`, **Ctrl + Alt + D** muestra una barra para forzar los estados del orbe.

## Cómo habla con Claude
Orbe usa un proveedor u otro según `ORBE_PROVEEDOR` (por defecto `auto`):

| Proveedor | Cuándo | Cómo |
|---|---|---|
| `cli` | Por defecto | Lanza `claude -p` en modo headless, sin herramientas, sin tus ajustes ni hooks, y mantiene **un único proceso por conversación** (el propio CLI recuerda el contexto). Usa tu sesión de Claude. Ocupa unos 190 MB mientras hay conversación. |
| `api` | Si hay `ANTHROPIC_API_KEY` en `.env` | SDK oficial `@anthropic-ai/sdk`, en streaming. Orbe guarda el historial y lo reenvía en cada turno. La clave solo existe en el proceso principal. |

El CLI se lanza sin `ANTHROPIC_API_KEY` en su entorno, para que no te cobre por API sin que lo hayas decidido.

Variables del `.env`: `ORBE_PROVEEDOR`, `ORBE_MODELO` (por defecto `claude-sonnet-5-5`), `ORBE_ESFUERZO` (`low`…`max`, por defecto `medium`), `ANTHROPIC_API_KEY`, `CLAUDE_CLI_PATH`. En el modo API, Orbe pide además a Anthropic que, si un clasificador de seguridad rechaza una petición legítima, la reintente en el servidor con el modelo de respaldo recomendado (`fallbacks: "default"`).

### Errores
Orbe traduce los fallos a mensajes claros, con un botón **Reintentar** cuando tiene sentido y los detalles técnicos plegados:
sin conexión (el CLI reintenta hasta 10 veces durante minutos; Orbe se rinde tras 3), sesión de Claude sin iniciar, API key no válida, límite de uso (con la hora de reinicio si se conoce), servidores saturados, modelo inexistente, problemas de cuenta, respuesta rechazada por seguridad y tiempo de espera agotado.

## Pruebas
`npm test` ejecuta unas 150 pruebas, sin gastar nada: la lógica pura (parser del protocolo del CLI, errores, configuración), el proveedor del CLI contra un CLI de mentira (`tests/falso-claude.mjs`) y el proveedor de la API contra un servidor SSE local.

Para probar con el CLI real (gasta unos céntimos de tu plan):
```powershell
$env:ORBE_PRUEBA_REAL = '1'; npm test -- tests/integracion
```

## Estructura
```
src/main       proceso principal (ventana, atajos, ajustes, chat)
src/main/chat  proveedores (CLI y API), errores, servicio, IPC
src/preload    puente seguro hacia la interfaz
src/renderer   interfaz: orbe (WebGL2 + GLSL con ruido simplex) y panel de chat
src/shared     tipos compartidos
tests          pruebas unitarias (vitest) e integración opcional
```

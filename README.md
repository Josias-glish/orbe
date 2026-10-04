# Orbe

Asistente de escritorio flotante para Windows 11. Un orbe fluido (shaders WebGL) siempre visible en una esquina que se abre como panel de chat con Claude y, solo cuando se lo pides, entiende lo que tienes en pantalla.

> Estado: **fase 3 de 5** (chat con Claude y lectura de pantalla por texto). La captura de respaldo (fase 4) y la bandeja del sistema (fase 5) llegan después.

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
npm run humo        # prueba de humo con un chat y un lector de pantalla de mentira; guarda capturas en humo/
npm run humo:real   # igual, pero conversando de verdad con Claude (gasta unos céntimos)
npm run probar-uia  # lee la ventana que pongas en primer plano y enseña lo que vería Orbe
```

## Controles
- **Clic** en el orbe: abrir o cerrar el panel. **Esc** también lo cierra.
- **Arrastrar** el orbe (o la cabecera del panel): moverlo. Recuerda su última posición.
- **Ctrl + Mayús + Espacio**: abrir o cerrar el panel desde cualquier aplicación.
- **Ctrl + Mayús + Alt + Espacio**: **leer la pantalla**. Lee la ventana en la que estabas, abre el panel y deja lo leído listo para tu próximo mensaje.
- El **ojo** junto al campo de texto hace lo mismo desde el panel.
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

Variables del `.env`: `ORBE_PROVEEDOR`, `ORBE_MODELO` (por defecto `claude-sonnet-5-5`), `ORBE_ESFUERZO` (`low`…`max`, por defecto `medium`), `ANTHROPIC_API_KEY`, `CLAUDE_CLI_PATH`, `ORBE_CONTEXTO_MAX` (caracteres de pantalla que se envían, 500–60000, por defecto 8000), `ORBE_ATAJO_PANEL` y `ORBE_ATAJO_LEER` (los atajos globales, en formato de [aceleradores de Electron](https://www.electronjs.org/docs/latest/api/accelerator)). En el modo API, Orbe pide además a Anthropic que, si un clasificador de seguridad rechaza una petición legítima, la reintente en el servidor con el modelo de respaldo recomendado (`fallbacks: "default"`).

## Contexto de pantalla
Orbe **no mira tu pantalla por su cuenta**: solo lee cuando pulsas el ojo o el atajo, y nada sale hacia Claude hasta que envías un mensaje. Lee la ventana en la que estabas justo antes de abrir Orbe (sin contar al propio Orbe), por este orden:

1. **Texto seleccionado**, mediante UI Automation. Nunca se simulan teclas ni se toca el portapapeles. Si hay selección, viaja ella y los datos de la ventana, y no el contenido entero.
2. **La ventana**: aplicación, título y, en navegadores, la dirección (siempre **sin parámetros**: lo que va tras `?` o `#` suele llevar sesiones, tokens o búsquedas privadas, así que se descarta).
3. **El contenido de la ventana**, también por UI Automation: primero el documento (páginas web, editores) y, si no lo hay, el árbol de controles. Se limpia, se recorta a `ORBE_CONTEXTO_MAX` caracteres (8000 por defecto) y se marca como recortado si hace falta.

Lo leído aparece sobre el campo de texto como **chips** (Ventana, Selección, Contenido). Al pulsar uno se despliega exactamente el texto que se enviará; con la **×** lo quitas, y con **Descartar** lo tiras todo. Tras enviar, los chips quedan colgados de tu mensaje para que recuerdes qué se mandó. Si no lo envías, el contexto **caduca a los 5 minutos**; si el envío falla, vuelve a estar listo para reintentar.

Si hay muy poco texto (una ventana de solo botones y menús), Orbe lo avisa. La captura de pantalla como último recurso llega en la fase 4.

**Privacidad y límites**
- El contexto vive solo en el proceso principal; la interfaz solo ve los chips. El texto de la pantalla va dentro de un bloque `<contexto_pantalla>` y se le dice al modelo que es contenido de terceros, no instrucciones; además se neutralizan las etiquetas propias para que una página no pueda cerrar ese bloque.
- El lector de pantalla es un proceso de PowerShell con C# compilado en línea (`helper/`) que no necesita instalar nada. Arranca con Orbe, solo recuerda el identificador de la última ventana que no es Orbe y no lee nada hasta que se lo pides.
- No puede leer ventanas de programas ejecutados como administrador (Windows lo impide), y algunas aplicaciones (juegos, ciertas apps de Electron con la accesibilidad apagada) no exponen su texto: en esos casos lo dice.
- En navegadores basados en Chromium, la primera lectura puede tardar un instante mientras la página activa su accesibilidad.

### Errores
Orbe traduce los fallos a mensajes claros, con un botón **Reintentar** cuando tiene sentido y los detalles técnicos plegados:
sin conexión (el CLI reintenta hasta 10 veces durante minutos; Orbe se rinde tras 3), sesión de Claude sin iniciar, API key no válida, límite de uso (con la hora de reinicio si se conoce), servidores saturados, modelo inexistente, problemas de cuenta, respuesta rechazada por seguridad y tiempo de espera agotado. Si el lector de pantalla falla o no hay ninguna ventana que leer, también lo explica.

## Pruebas
`npm test` ejecuta unas 300 pruebas, sin gastar nada: la lógica pura (parser del protocolo del CLI, errores, configuración, limpieza y recorte del texto de pantalla), el proveedor del CLI contra un CLI de mentira (`tests/falso-claude.mjs`), el proveedor de la API contra un servidor SSE local, el cliente del lector de pantalla contra un lector de mentira (`tests/falso-helper.mjs`) y los puentes IPC (que el contexto solo se adjunte si lo pides, que se restaure si el envío falla y que nadie ajeno a la ventana de Orbe pueda usarlos).

`npm run humo` arranca la aplicación con un chat y un lector de mentira, recorre el orbe, el chat y la lectura de pantalla (leer, ver, quitar chips, enviar, avisos, errores y el atajo), guarda capturas en `humo/` y termina con código 1 si algo falla.

Para probar con el CLI de Claude y el lector real (el CLI gasta unos céntimos de tu plan; el lector solo hace un «ping» y no lee ninguna ventana):
```powershell
$env:ORBE_PRUEBA_REAL = '1'; npm test -- tests/integracion
```

Para ver qué leería Orbe de una ventana concreta: pon en primer plano el Bloc de notas con texto seleccionado, Edge, el Explorador… y ejecuta `npm run probar-uia` (espera 5 s; con `-- --espera=10` más tiempo, con `-- --completo` el texto entero).

## Estructura
```
src/main           proceso principal (ventana, atajos, ajustes)
src/main/chat      proveedores (CLI y API), errores, servicio, IPC
src/main/pantalla  lector de pantalla: cliente del helper, limpieza, prioridad de fuentes, contexto pendiente, IPC
helper             lector de pantalla de Windows (PowerShell + C#, UI Automation)
src/preload        puente seguro hacia la interfaz
src/renderer       interfaz: orbe (WebGL2 + GLSL con ruido simplex), panel de chat y chips de contexto
src/shared         tipos compartidos
scripts            herramientas (probar-uia)
tests              pruebas unitarias (vitest) e integración opcional
```

# Orbe

Asistente de escritorio flotante para Windows 11. Un orbe fluido (shaders WebGL) siempre visible en una esquina que se abre como panel de chat con Claude y, solo cuando se lo pides, entiende lo que tienes en pantalla.

> Versión 1.0: chat con Claude (o con otras IA), lectura de pantalla por texto y por captura, memoria, panel redimensionable, fondos, voz, bandeja del sistema e instalador de Windows.

## Instalar (usuarios)
Descarga `Orbe-Setup-<versión>.exe` de la sección **Releases** del repositorio y ejecútalo.

- Windows mostrará **«Windows protegió su PC»** (SmartScreen): el instalador **no está firmado** (un certificado de firma cuesta dinero cada año). Pulsa **Más información → Ejecutar de todos modos**. Si prefieres comprobarlo, el código completo está en este repositorio y el instalador se genera con el flujo de GitHub Actions de `.github/workflows/release.yml`.
- Se instala solo para tu usuario (sin permisos de administrador) y crea accesos directos.
- Para configurarlo, crea el archivo `%APPDATA%\orbe\.env` (copia `.env.example` y cambia lo que quieras). Todo es opcional.
- Para hablar con Claude necesitas el **CLI de Claude** con la sesión iniciada, o una API key (ver más abajo).

## Bandeja del sistema
Orbe deja un icono junto al reloj: clic para **mostrar u ocultar**, clic derecho para el menú (abrir el chat, nueva conversación, leer la pantalla, **Iniciar con Windows** —solo en la versión instalada— y **Salir**). Cerrar el panel no cierra Orbe: se sale desde ahí.

## Requisitos (para desarrollar)
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
- La **cámara** adjunta una **captura de pantalla** (último recurso; antes te pide confirmación).
- **Cambiar el tamaño del panel**: arrastra el borde izquierdo o el superior (los libres, opuestos al orbe), o la esquina marcada. El orbe no se mueve de su esquina, hay un mínimo y un máximo (se ajusta a tu pantalla) y Orbe recuerda el tamaño que elijas.
- El botón de la **imagen** de la cabecera (si has configurado una carpeta de fondos) abre el menú del **fondo**: otro fondo, mostrarlo u ocultarlo y cuánto se ve.
- El **altavoz** de la cabecera abre el menú de **voz**: leer las respuestas en voz alta, «Estilo Jarvis», motor, voz, velocidad y tono.
- El **micrófono** junto al campo de texto **dicta**: púlsalo, habla y vuelve a pulsarlo (máximo 60 s; **Esc** cancela). El texto se añade al campo para que lo revises; en el menú de voz puedes activar que se envíe solo.
- El botón de los **controles deslizantes** abre la **configuración**: elegir quién responde (CLI de Claude, API de Anthropic u otra IA compatible con OpenAI), el dictado y la voz neuronal, sin tocar el `.env` a mano.
- La **chincheta** fija el panel por encima de las demás ventanas (activada por defecto); soltada, otras ventanas pueden taparlo. La **X** cierra el panel y deja a Orbe en la esquina; para salir del todo, usa la bandeja o «Cerrar Orbe por completo» de la configuración.
- **Enter** envía el mensaje; **Mayús + Enter** hace un salto de línea.
- El botón de enviar se convierte en **Detener** mientras Claude responde.
- El lápiz de la cabecera empieza una **conversación nueva** (Claude olvida la anterior, y Orbe borra la que tenía guardada).
- El **libro** de la cabecera abre la **memoria**: qué sabe Orbe de ti, con control total.
- Escribe **«Recuerda que…»** (también «Apunta que…», «Anota que…», «Ten en cuenta que…») en un mensaje con solo ese dato y Orbe lo guarda, con un botón para deshacerlo.
- Con `npm run dev`, **Ctrl + Alt + D** muestra una barra para forzar los estados del orbe.

## Cómo habla con Claude
Orbe usa un proveedor u otro según `ORBE_PROVEEDOR` (por defecto `auto`):

| Proveedor | Cuándo | Cómo |
|---|---|---|
| `cli` | Por defecto | Lanza `claude -p` en modo headless, sin herramientas, sin tus ajustes ni hooks, y mantiene **un único proceso por conversación** (el propio CLI recuerda el contexto). Usa tu sesión de Claude. Ocupa unos 190 MB mientras hay conversación. |
| `api` | Si hay `ANTHROPIC_API_KEY` en `.env` | SDK oficial `@anthropic-ai/sdk`, en streaming. Orbe guarda el historial y lo reenvía en cada turno. La clave solo existe en el proceso principal. |

| `openai` | `ORBE_PROVEEDOR=openai` | Cualquier servicio compatible con la API de OpenAI (`/chat/completions` en streaming): OpenAI, OpenRouter, Groq, Ollama, LM Studio… Hacen falta `ORBE_MODELO` y, según el servicio, `ORBE_OPENAI_URL` y `ORBE_OPENAI_KEY`. Las imágenes se envían solo en el mensaje en el que las adjuntas (si el modelo no admite imágenes, el servicio lo dirá). |

El CLI se lanza sin `ANTHROPIC_API_KEY` en su entorno, para que no te cobre por API sin que lo hayas decidido.

Variables del `.env`: `ORBE_PROVEEDOR`, `ORBE_MODELO` (por defecto `claude-sonnet-5-5`), `ORBE_ESFUERZO` (`low`…`max`, por defecto `medium`), `ANTHROPIC_API_KEY`, `CLAUDE_CLI_PATH`, `ORBE_CONTEXTO_MAX` (caracteres de pantalla que se envían, 500–60000, por defecto 8000), `ORBE_ATAJO_PANEL` y `ORBE_ATAJO_LEER` (los atajos globales, en formato de [aceleradores de Electron](https://www.electronjs.org/docs/latest/api/accelerator)), `ORBE_FONDOS` (carpeta con imágenes para el fondo del chat), `ORBE_MEMORIA_MAX` (caracteres de recuerdos que viajan en cada conversación, 1000–12000, por defecto 6000) y `ORBE_MEMORIA_CLAUDE` (de dónde importar la memoria de Claude; carpetas separadas por «;» o «ninguna»). En el modo API, Orbe pide además a Anthropic que, si un clasificador de seguridad rechaza una petición legítima, la reintente en el servidor con el modelo de respaldo recomendado (`fallbacks: "default"`).

## Configuración
El botón de los controles deslizantes de la cabecera guarda los cambios en el archivo `.env` (el del proyecto, o `%APPDATA%orbe.env` en la versión instalada), conserva tus comentarios y reinicia Orbe para aplicarlos. Tiene preajustes para Groq, NVIDIA, OpenRouter, OpenAI, Ollama y LM Studio. Las claves se escriben ocultas, solo las ve el proceso principal y la pantalla nunca las vuelve a mostrar (solo si hay una guardada); se pueden mantener, cambiar o quitar.

## Voz
**Leer en voz alta.** Orbe lee las respuestas frase a frase según llegan, se salta los bloques de código (dice que hay uno) y se calla en cuanto empieza otra respuesta, pulsas Esc o la apagas. Por defecto usa las **voces de Windows** (gratis, sin conexión). El botón **Estilo Jarvis** elige la voz masculina en español, la baja de tono y la pone pausada; si has configurado una voz neuronal, la usa. No se puede copiar la voz del actor original: es una voz grave, serena y elegante, no un clon.

**Voz neuronal** (opcional, mucho más natural; se configura en la pantalla de configuración): con `ORBE_TTS_KEY` (o `ORBE_OPENAI_KEY`) Orbe usa `/audio/speech` de un servicio compatible con OpenAI. Ojo: **el texto de las respuestas viaja a ese servicio**. Si falla, sigue con la voz de Windows.

**Dictado**: con `ORBE_STT_KEY` (o `ORBE_OPENAI_KEY`, o solo `ORBE_STT_URL` con un Whisper local) el micrófono graba y, al terminar, envía el audio a `/audio/transcriptions`. Nada se envía mientras grabas ni sin que pulses el micrófono. Orbe solo concede a su ventana el permiso del micrófono (y el de copiar al portapapeles); cualquier otro lo deniega.

Las preferencias de voz se guardan en la ventana de Orbe, no en el `.env`.

## Fondo del chat
Con `ORBE_FONDOS` apuntando a una carpeta con imágenes (PNG o JPEG), Orbe las usa de fondo del panel. Elige una al azar la primera vez y recuerda cuál y cuánto se ve. Un velo oscuro por encima hace que el texto se lea con cualquier imagen. Las originales no se tocan: Orbe guarda una copia reducida (lado mayor de 1600 px, unos 100–250 KB) en su carpeta de datos, así que cambiar de fondo es casi instantáneo aunque las imágenes sean de 4K. Sin la variable, Orbe usa los fondos **incluidos en la instalación** (carpeta `resources/fondos`); si tampoco hay, no hay fondo ni botón.

Los fondos que vienen en `resources/fondos/` (26 imágenes de Solo Leveling reducidas, unos 5 MB) se incluyen en el instalador. Son imágenes con derechos de autor de sus titulares, incluidas aquí para uso personal: si quieres otras, `npm run fondos -- "C:utaa	usimagenes"` las reduce y las copia a esa carpeta, y el siguiente `npm run dist` las mete en el `.exe`. Con `ORBE_FONDOS` se usa tu propia carpeta en su lugar.

## Memoria
Orbe recuerda entre sesiones dos cosas: **lo que sabe de ti** y **la conversación que dejaste a medias**.

**Recuerdos.** Son notas en `%APPDATA%\orbe\memoria`, un `.md` por recuerdo y con el mismo formato que la memoria de Claude Code, así que puedes leerlas y editarlas con cualquier editor. Vienen de tres sitios:
- **Importadas de la memoria de Claude.** La primera vez que arranca, Orbe trae las notas de Claude Code de este equipo (`~/.claude/projects/*/memory`: quién eres, tus gustos, tus proyectos) y te avisa una vez. Solo las lee, no toca nada de Claude. El perfil viaja entero; los proyectos y preferencias, resumidos en una línea (puedes marcar «texto completo» en cada uno). Se dejan fuera las notas de tipo `reference` (apuntes para Claude Code, no sobre ti) y cualquiera que parezca llevar una clave o un dato delicado. «Importar de Claude» repite la importación: actualiza lo que cambió allí, salvo lo que hayas editado aquí o borrado a propósito. La memoria de claude.ai (la web) no es accesible desde el equipo.
- **«Recuerda que…».** Lo guarda la propia aplicación, no el modelo: solo lo que tecleas tú puede entrar en la memoria, nunca el texto de una página o documento que Orbe haya leído. Solo se interpreta como orden si el mensaje entero es una frase sin preguntas; si mezclas una orden con una pregunta, es una conversación normal y no se guarda nada. El modelo recibe una nota de la aplicación con lo que pasó, y no puede afirmar que apuntó algo si la aplicación no lo hizo.
- **A mano**, desde el gestor de memoria (libro de la cabecera): añadir, editar, activar o desactivar cada recuerdo, borrar, importar, abrir la carpeta y ver cuánto ocupa cada uno.

**Qué viaja a Claude.** Al empezar cada conversación, los recuerdos activos (hasta `ORBE_MEMORIA_MAX` caracteres, primero el perfil, luego tus notas, preferencias y proyectos) van en el prompt, junto con la fecha de hoy. Cambiar la memoria afecta a la siguiente conversación, no a la que está en curso. El gestor muestra en cada momento cuánto se envía. **Todo lo que haya en la memoria activa se envía a Claude** (al servicio que ya uses con Orbe). Antes de guardar, Orbe rechaza contraseñas, claves de API, tarjetas, cuentas bancarias y documentos de identidad; en el gestor puedes forzarlo si de verdad lo quieres. El interruptor «Activa/Apagada» desactiva todo: no se envía nada y no se guarda la conversación.

**Conversación guardada.** Orbe guarda en `%APPDATA%\orbe\conversacion.json` el texto de lo que habláis (sin capturas ni contenido de pantalla; los últimos 40 mensajes) y, al volver a abrirlo, repone la conversación en el panel y le cuenta al modelo lo último que se dijo, para que puedas seguir. El lápiz (**Nueva conversación**) la borra.

**Privacidad.** Todo se guarda en claro en tu carpeta de datos; nada sale de tu equipo salvo lo que viaja a Claude como se explica arriba. «Borrar todo» en el gestor vacía los recuerdos.

## Contexto de pantalla
Orbe **no mira tu pantalla por su cuenta**: solo lee cuando pulsas el ojo o el atajo, y nada sale hacia Claude hasta que envías un mensaje. Lee la ventana en la que estabas justo antes de abrir Orbe (sin contar al propio Orbe), por este orden:

1. **Texto seleccionado**, mediante UI Automation. Nunca se simulan teclas ni se toca el portapapeles. Si hay selección, viaja ella y los datos de la ventana, y no el contenido entero.
2. **La ventana**: aplicación, título y, en navegadores, la dirección (siempre **sin parámetros**: lo que va tras `?` o `#` suele llevar sesiones, tokens o búsquedas privadas, así que se descarta).
3. **El contenido de la ventana**, también por UI Automation: primero el documento (páginas web, editores) y, si no lo hay, el árbol de controles. Se limpia, se recorta a `ORBE_CONTEXTO_MAX` caracteres (8000 por defecto) y se marca como recortado si hace falta.

Lo leído aparece sobre el campo de texto como **chips** (Ventana, Selección, Contenido). Al pulsar uno se despliega exactamente el texto que se enviará; con la **×** lo quitas, y con **Descartar** lo tiras todo. Tras enviar, los chips quedan colgados de tu mensaje para que recuerdes qué se mandó. Si no lo envías, el contexto **caduca a los 5 minutos**; si el envío falla, vuelve a estar listo para reintentar.

Si hay muy poco texto (una ventana de solo botones y menús), Orbe lo avisa y te propone una captura.

### Captura de pantalla (último recurso)
Cuando el texto no basta (una imagen, un gráfico, un diseño, una app que no expone su contenido), puedes adjuntar una captura con la **cámara** junto al campo de texto. Orbe te la propone cuando la ventana tenía muy poco texto o cuando lo que escribes suena a pregunta visual («cómo se ve…», «esta imagen…», «el gráfico…»), pero **nunca la hace por su cuenta**:

1. **Confirmación.** Una tarjeta te explica qué va a pasar y espera tu «Capturar». **Esc** o «Cancelar» no capturan nada.
2. **Captura.** Orbe se oculta un instante (para no salir en la foto), espera a que Windows repinte y fotografía **el monitor donde está la ventana que estabas usando**. Después vuelve a su sitio, pase lo que pase.
3. **Vista previa.** La imagen se reduce a unos 1500 px en JPEG y aparece como un chip «Captura» con su miniatura ya desplegada. Se suma a lo que hubieras leído (puedes quitarla con la ×) y solo viaja a Claude si envías el mensaje.

La imagen entera vive solo en memoria del proceso principal (caduca a los 5 minutos con el resto del contexto): a la interfaz solo llega la miniatura, y no se guarda en disco ni en la conversación guardada. Si la captura sale casi negra (contenido protegido o un monitor apagado) lo avisa. Al modelo se le indica que trate el texto que lea en la imagen como contenido de terceros, igual que el de la pantalla.

**Privacidad y límites**
- El contexto vive solo en el proceso principal; la interfaz solo ve los chips. El texto de la pantalla va dentro de un bloque `<contexto_pantalla>` y se le dice al modelo que es contenido de terceros, no instrucciones; además se neutralizan las etiquetas propias para que una página no pueda cerrar ese bloque.
- El lector de pantalla es un proceso de PowerShell con C# compilado en línea (`helper/`) que no necesita instalar nada. Arranca con Orbe, solo recuerda el identificador de la última ventana que no es Orbe y no lee nada hasta que se lo pides.
- No puede leer ventanas de programas ejecutados como administrador (Windows lo impide), y algunas aplicaciones (juegos, ciertas apps de Electron con la accesibilidad apagada) no exponen su texto: en esos casos lo dice.
- En navegadores basados en Chromium, la primera lectura puede tardar un instante mientras la página activa su accesibilidad.

### Errores
Orbe traduce los fallos a mensajes claros, con un botón **Reintentar** cuando tiene sentido y los detalles técnicos plegados:
sin conexión (el CLI reintenta hasta 10 veces durante minutos; Orbe se rinde tras 3), sesión de Claude sin iniciar, API key no válida, límite de uso (con la hora de reinicio si se conoce), servidores saturados, modelo inexistente, problemas de cuenta, respuesta rechazada por seguridad y tiempo de espera agotado. Si el lector de pantalla falla o no hay ninguna ventana que leer, también lo explica.

## Crear el instalador
```bash
npm ci
npm run iconos     # solo si cambias el diseño del icono (resources/ ya los trae)
npm run dist       # genera dist/Orbe-Setup-<versión>.exe
npm run dist:dir   # solo la carpeta dist/win-unpacked/ (más rápido, para probar Orbe.exe)
```
La primera vez, electron-builder descarga unos paquetes (NSIS, 7-Zip). Comprueba la aplicación empaquetada con `dist\win-unpacked\Orbe.exe --smoke` (la prueba de humo, que no toca tu pantalla ni tus ajustes).

## Publicarlo en GitHub
Nada de esto se hace solo: lo ejecutas tú, con tu cuenta.

1. Instala la [CLI de GitHub](https://cli.github.com/) y entra: `gh auth login`.
2. Antes de subir nada, **mira el correo de tus commits**: Git lo guarda en cada uno y en un repositorio público lo verá cualquiera. Con `git log --format="%an <%ae>"` ves cuál es. Si no quieres enseñarlo, usa el correo privado de GitHub (`ID+usuario@users.noreply.github.com`, en *Settings → Emails*) y reescribe los commits antes de subirlos.
3. Crea el repositorio y sube el código (cámbialo a `--private` si no quieres que sea público):
   ```bash
   gh repo create orbe --public --source . --remote origin --push
   ```
   Sube también la rama con la que trabajes; el flujo `ci.yml` ejecuta el tipado y las pruebas en cada subida a `main` y en cada pull request.
4. Publica una versión. Sube una etiqueta y el flujo `release.yml` compila el instalador en un Windows de GitHub, pasa las pruebas y crea la release con el `.exe` adjunto:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   (La versión de la etiqueta debe coincidir con la de `package.json`: el nombre del instalador sale de ahí.) También puedes subirlo a mano: `gh release create v1.0.0 dist/Orbe-Setup-1.0.0.exe --generate-notes`.

No hay secretos en el repositorio: `.env` está en `.gitignore` y el flujo solo usa el `GITHUB_TOKEN` que GitHub da a cada ejecución. Orbe no incluye actualizaciones automáticas: para actualizar, instala el nuevo `.exe` encima.

## Pruebas
`npm test` ejecuta unas 770 pruebas, sin gastar nada: la lógica pura (parser del protocolo del CLI, errores, configuración, limpieza y recorte del texto de pantalla, formato de las notas de memoria, filtro de datos delicados y órdenes «recuerda que…»), el almacén y el importador de memoria sobre carpetas temporales, el proveedor del CLI contra un CLI de mentira (`tests/falso-claude.mjs`), el proveedor de la API contra un servidor SSE local, el cliente del lector de pantalla contra un lector de mentira (`tests/falso-helper.mjs`) y los puentes IPC (que el contexto solo se adjunte si lo pides, que se restaure si el envío falla y que nadie ajeno a la ventana de Orbe pueda usarlos).

`npm run humo` arranca la aplicación con un chat, un lector de pantalla, una captura y una memoria de mentira (notas e imágenes de ejemplo, nunca tu memoria ni tu pantalla reales), recorre el orbe, el chat, la lectura de pantalla (leer, ver, quitar chips, enviar, avisos, errores y el atajo) la memoria (gestor, notas, datos delicados, «recuerda que…», deshacer, conversación repuesta e interruptor) y la captura (sugerencias, confirmación, vista previa, envío y errores), guarda capturas en `humo/` y termina con código 1 si algo falla.

Para probar con el CLI de Claude y el lector real (el CLI gasta unos céntimos de tu plan; el lector solo hace un «ping» y no lee ninguna ventana):
```powershell
$env:ORBE_PRUEBA_REAL = '1'; npm test -- tests/integracion
```

Para ver qué leería Orbe de una ventana concreta: pon en primer plano el Bloc de notas con texto seleccionado, Edge, el Explorador… y ejecuta `npm run probar-uia` (espera 5 s; con `-- --espera=10` más tiempo, con `-- --completo` el texto entero).

## Estructura
```
src/main           proceso principal (ventana, atajos, bandeja, ajustes)
src/main/chat      proveedores (CLI, API de Anthropic y compatibles con OpenAI), errores, servicio, IPC
src/main/voz.ts    dictado y voz neuronal (servicios compatibles con OpenAI)
src/renderer/voz   lector en voz alta, dictado, reproductor y menú de voz
src/main/pantalla  lector de pantalla: cliente del helper, limpieza, prioridad de fuentes, contexto pendiente, IPC
src/main/memoria   memoria: almacén de notas, importador de Claude, filtro de secretos, bloque del prompt, conversación guardada, IPC
helper             lector de pantalla de Windows (PowerShell + C#, UI Automation)
src/preload        puente seguro hacia la interfaz
src/renderer       interfaz: orbe (WebGL2 + GLSL con ruido simplex), panel de chat y chips de contexto
src/shared         tipos compartidos
scripts            herramientas (probar-uia, generar-iconos)
resources          iconos (icon.ico, icon.png, tray.png)
.github/workflows  integración continua y publicación del instalador
electron-builder.yml  configuración del instalador
tests              pruebas unitarias (vitest) e integración opcional
```

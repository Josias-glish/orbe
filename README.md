# Orbe

Asistente de escritorio flotante para Windows 11. Un orbe fluido (shaders WebGL) siempre visible en una esquina que se abre como panel de chat con Claude y, solo cuando se lo pides, entiende lo que tienes en pantalla.

> Versión 1.3: un **conejo en 3D** con 20 expresiones en sus gafas y sonidos (o el personaje dibujado con 20 diseños, o uno tuyo de Rive), avisos de Claude Code y otras herramientas, chat con Claude (o con otras IA, también Gemini de Google AI Studio), **texto de imágenes sin pantallazo** (OCR de Windows en tu equipo), **fórmulas y química resueltas desde una imagen** (con las fórmulas bien escritas), lectura de pantalla por texto y por captura, memoria, panel redimensionable, fondos, voz, bandeja del sistema, instalador de Windows y un **modo agente** que además de responder puede buscar en internet y abrir páginas y aplicaciones (ver «Modo agente»).

## Instalar (usuarios)
En la sección **Releases** del repositorio (o en «Artifacts» de cada ejecución del flujo CI) hay tres opciones; elige la que prefieras:

| Archivo | Qué es |
|---|---|
| `Orbe-Setup-<versión>.exe` | **Instalador**: eliges la carpeta, crea accesos directos, se desinstala desde Windows y permite «Iniciar con Windows». |
| `Orbe-Portable-<versión>.exe` | **Portable**: un solo `.exe` que se abre sin instalar nada (sirve desde un USB). La primera vez tarda unos segundos en abrir. |
| `Orbe-<versión>-win.zip` | **Carpeta comprimida**: descomprímela donde quieras y abre `Orbe.exe`. |

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
- **Barra lateral** (a la izquierda del panel): **Chat**, **Tareas** (reloj), **Consumo** (gráfico), **Memoria** (libro) y **Personaje** (carita, con expresiones, gestos y actividad); abajo, **Voz** (altavoz), **Fondo** (imagen) y **Configuración** (controles deslizantes, organizada en grupos: Inteligencia, Personaje y avisos, Dictado, Voz, Identidad y Conectores). En la cabecera solo quedan la potencia, conversación nueva, la chincheta y cerrar.
- **Doble clic** en el personaje: abrir o cerrar el chat (también **Ctrl + Mayús + Espacio** o la bandeja). Un **clic** solo lo hace jugar (salta, saluda, baila…), así no se abre el chat por tocarlo sin querer. **Esc** cierra el panel.
- **Solo se toca el centro del personaje**: en Windows y macOS, el resto de su cuadro (las esquinas y los lados transparentes) deja pasar los clics a lo que haya debajo, así no tapa pestañas ni botones de otras aplicaciones. Con el panel abierto, igual: solo el panel y el centro del personaje reciben el ratón.
- **Arrastrar** el personaje desde su centro (o la cabecera del panel): moverlo. Recuerda su última posición.
- **Ctrl + Mayús + Espacio**: abrir o cerrar el panel desde cualquier aplicación.
- **Ctrl + Mayús + Retroceso**: **detener todo** lo que esté haciendo el agente.
- **Ctrl + Mayús + Alt + Espacio**: **leer la pantalla**. Lee la ventana en la que estabas, abre el panel y deja lo leído listo para tu próximo mensaje.
- El **ojo** junto al campo de texto hace lo mismo desde el panel.
- El botón **[T]** lee el **texto de una imagen sin pantallazo** o **reconoce y resuelve una fórmula o una estructura química**: de la ventana que estabas usando, del portapapeles o de un archivo (ver «Texto de una imagen» y «Fórmulas»).
- La **cámara** adjunta una **captura de pantalla** (último recurso; antes te pide confirmación).
- **Cambiar el tamaño del panel**: arrastra el borde izquierdo o el superior (los libres, opuestos al orbe), o la esquina marcada. El orbe no se mueve de su esquina, hay un mínimo y un máximo (se ajusta a tu pantalla) y Orbe recuerda el tamaño que elijas.
- El botón de la **imagen** de la barra lateral (si has configurado una carpeta de fondos) abre el menú del **fondo**: otro fondo, mostrarlo u ocultarlo y cuánto se ve.
- El **altavoz** de la barra lateral abre el menú de **voz**: leer las respuestas en voz alta, «Estilo Jarvis», motor, voz, velocidad y tono.
- El **micrófono** junto al campo de texto **dicta**: púlsalo, habla y vuelve a pulsarlo (máximo 60 s; **Esc** cancela). El texto se añade al campo para que lo revises; en el menú de voz puedes activar que se envíe solo.
- El botón de los **controles deslizantes** abre la **configuración**: elegir quién responde (CLI de Claude, API de Anthropic u otra IA compatible con OpenAI), el dictado y la voz neuronal, sin tocar el `.env` a mano.
- La **chincheta** fija el panel por encima de las demás ventanas (activada por defecto); soltada, otras ventanas pueden taparlo. La **X** cierra el panel y deja a Orbe en la esquina; para salir del todo, usa la bandeja o «Cerrar Orbe por completo» de la configuración.
- **Enter** envía el mensaje; **Mayús + Enter** hace un salto de línea.
- El botón de enviar se convierte en **Detener** mientras Claude responde.
- El lápiz de la cabecera empieza una **conversación nueva** (Claude olvida la anterior, y Orbe borra la que tenía guardada).
- El **libro** de la barra lateral abre la **memoria**: qué sabe Orbe de ti, con control total.
- Escribe **«Recuerda que…»** (también «Apunta que…», «Anota que…», «Ten en cuenta que…») en un mensaje con solo ese dato y Orbe lo guarda, con un botón para deshacerlo.
- Con `npm run dev`, **Ctrl + Alt + D** muestra una barra para forzar los estados del orbe.

## El personaje
Por defecto, en la esquina vive **el conejo en 3D**: busto con pelo negro, auriculares blancos, gafas negras y sudadera de punto con el orbe en el pecho. Lo dibuja [three.js](https://threejs.org) dentro de la misma ventana de Orbe, sin programas aparte: unos 260.000 triángulos con texturas PBR de 2K (el modelo pesa 3,6 MB; en la GPU ocupa unos 100 MB), a 30 fps en reposo y 60 cuando hace algo; se para si no se ve.

- **Las gafas son su pantalla**: las 20 expresiones se dibujan como ojos de luz en los cristales (ojos que sonríen, corazones, estrellas, espirales, cejas de enfado…). Gira la cabeza hacia el cursor, respira, bota al responder, se ladea según la expresión, y su contraluz cambia de color con el estado (pensando, respondiendo, actuando).
- **Pelo y tejido de cerca**: encima de la textura del modelo se aplican texturas de detalle repetibles (`resources/personaje/pelo.jpg` y `tejido.jpg`): pelo corto y denso, mate, en la cabeza y las orejas, y el punto del tejido en la sudadera.
- **Cambia de cara solo**: al terminar de responder pone la cara que pega con lo que dijo (orgulloso si lo hizo, preocupado si no pudo, curioso si te pregunta algo, contento si no), reacciona a lo que escribes («gracias» lo pone tímido), y en reposo pone de vez en cuando una cara tranquila (un guiño, curioso, travieso…).
- **Reacciona a tu equipo**: si llevas 4 minutos sin tocar el teclado ni el ratón, o bloqueas la pantalla, o el equipo se suspende, se duerme; al volver, se despierta y se ríe. Se preocupa si el portátil pasa a batería y saluda al arrancar según la hora. Solo mira cuánto llevas inactivo y esos avisos de Windows: no lee nada tuyo.
- Mide 150 px en la esquina (antes 120).
- **Sonidos** cortos y suaves (sintetizados al momento, sin archivos): al abrir y cerrar, al acariciarlo, con la rueda, al arrastrarlo, al enviar y al terminar de responder, cuando se duerme y se despierta, y con los avisos de Claude Code. Se apagan en el menú de la carita.
- **Tu propio modelo**: `ORBE_MODELO_3D` con la ruta de un `.glb`. Si a su lado hay un `.json` con el mismo nombre, Orbe lo usa para saber dónde están las gafas (`lentes`), qué encuadrar (`encuadre`) y dónde acaba la ropa (`cuello`). `npm run modelo -- entrada.glb` lo optimiza (texturas a 2K y geometría comprimida) y `node scripts/galeria/fotos-3d.mjs` saca fotos con todas las expresiones.
- Si el equipo no tiene WebGL o el modelo falla, Orbe usa el personaje dibujado de abajo.

En la esquina ya no hay solo un orbe: hay un **personaje con 20 expresiones** (neutral, feliz, risa, tímido, guiño, enamorado, emocionado, sorprendido, curioso, pensativo, concentrado, confundido, triste, llorando, enfadado, preocupado, dormido, aburrido, travieso y orgulloso). Siempre está en primer plano, como antes.

- **Reacciona solo**: pone cara de pensar mientras la IA piensa, de contento al responder, de concentrado cuando el agente trabaja y de curioso al leer la pantalla. Parpadea, respira y **sigue el cursor con la mirada**. Si pasan 3 minutos sin que pase nada, se duerme, y se despierta cuando le acercas el ratón.
- **Puedes jugar con él**: si lo acaricias con el cursor, reacciona; la **rueda del ratón** encima recorre sus caras; al arrastrarlo se sorprende y al soltarlo se ríe. El botón de la carita de la cabecera abre las **20 expresiones**: pulsa una para fijarla o «Automático» para que cambie solo.
- **20 diseños** (forma, colores y accesorio), elegibles en la configuración o con `ORBE_DISENO` (`orbi`, `nimbo`, `pico`, `reina`, `chispa`, `copo`, `boo`, `menta`, `mishi`, `brote`, `gala`, `algodon`, `tico`, `noctis`, `lila`, `travi`, `bit`, `ritmo`, `neon`, `nieve`). `npm run galeria` saca una foto de todos (y de las 20 expresiones) en `galeria/`.
- **Personaje de Rive**: con `ORBE_APARIENCIA=rive` y `ORBE_RIVE_ARCHIVO` (un `.riv` hecho en [rive.app](https://rive.app)), Orbe mueve estas entradas de su máquina de estados (`ORBE_RIVE_MAQUINA`, o la primera): `expresion` (0–19, en el orden de arriba), `estado` (0 reposo, 1 leyendo, 2 pensando, 3 respondiendo, 4 escuchando, 5 actuando), `mirarX` y `mirarY` (-100…100), los disparadores `pulso` y `tocar`, y `hablando` (reservada para cuando tenga voz; hoy siempre es falsa). El motor de Rive va dentro de Orbe. Si el archivo falla, se usa el personaje dibujado.
- `ORBE_APARIENCIA=orbe` vuelve al orbe clásico.
- El personaje **no habla** todavía: la entrada `hablando` queda lista para cuando se conecte una voz (por ejemplo, ElevenLabs).

### Gestos (nunca se queda quieto)
El conejo hace **10 gestos con todo el cuerpo**: saludar (con una manita), saltar, asentir, negar, dar una vuelta, bailar, estirarse, mirar alrededor, sacudirse y hacer una reverencia. Saluda al arrancar y cuando vuelves al ordenador, salta al abrir el panel, celebra (reverencia o baile) cuando termina algo, niega con la cabeza si hay un error y te saluda cuando una tarea o Claude Code te necesita. En reposo hace uno tranquilo cada 16–38 s y pone una cara distinta cada 12–28 s. En el menú de la carita, **Gestos** los lanza al momento.

## Identidad: Orbe o Atlas

Además del Orbe de siempre (cercano, de tú), puedes elegir a **Atlas**, una entidad con identidad propia de mayordomo
digital: sereno, leal, con humor seco y franco con tacto. Te trata de usted (te llama «señor» o como elijas), te da
el **parte de situación** al abrir el panel cada día (agenda, tareas terminadas, permisos pendientes y consumo) y
convierte tus tareas en **protocolos**: escribe «protocolo Informe semanal» y lo pone en marcha. «parte» y «protocolo»
se resuelven en tu equipo, sin gastar tokens. Se activa en Configuración → Identidad (o `ORBE_IDENTIDAD=atlas`).
Investigación y diseño del personaje: [docs/IDENTIDAD-ATLAS.md](docs/IDENTIDAD-ATLAS.md).

## Tareas de fondo (al estilo de los agentes «siempre encendidos»)
El botón del reloj abre **Tareas**: instrucciones que Orbe hace **solo**, sin que estés mirando, con la IA que tengas configurada, tu memoria y las herramientas del agente. Es la misma idea que los agentes «siempre encendidos» como ChatGPT Dots, pero en tu equipo y con tu IA.

- **Cuándo**: ahora, una vez más tarde, cada día a una hora, algunos días de la semana o cada cierto tiempo (de 15 min a 24 h).
- **Tres listas**: **En curso** (lo que hace ahora y lo que está pidiendo), **Programadas** (con la próxima hora, un resumen de la última vez, Hacer ahora, Pausar, Editar y Borrar) y **Completadas** (cada vez, con su estado, hora, duración y un resumen de 3 líneas).
- **Resultado completo**: al pulsar un resumen se abre el resultado entero con formato (listas, negritas y enlaces que se abren en el navegador), con Repetir ahora, Copiar, Editar la tarea y las otras veces que se hizo.
- **Permisos**: lo delicado (abrir apps, enviar, comprar) **espera tu permiso** en «En curso». El botón del reloj muestra un globito amarillo y aparece una notificación de Windows. Si no respondes en 30 minutos, cuenta como «no».
- **«Avisarme solo si hay algo»**: si no hay nada nuevo, la ejecución queda como «nada nuevo» y no te molesta (ideal para vigilar un precio o una web).
- Cada ejecución es una conversación limpia (no mezcla tu chat). Se hace una tarea cada vez; las demás esperan en cola. Una tarea que tarde más de 15 minutos se detiene.
- Si Orbe estaba cerrado a la hora de una tarea, la hace al abrirse si se pasó hace menos de 12 horas; si no, espera a la siguiente.
- El personaje y las notificaciones avisan al empezar, al terminar, si hay un error o si te necesita. Se guardan en `%APPDATA%\orbe\tareas.json`.

## Consumo
El botón del gráfico abre **Consumo**: lo gastado **hoy, en 7 días y este mes** (dólares, tokens y peticiones), un gráfico de los últimos 14 días y el desglose **por modelo** (con el chat y las tareas).

- **CLI de Claude**: el coste lo calcula el propio CLI. Con una suscripción no pagas por token, así que es lo que costaría con la API. Además ves el **estado del límite de tu plan** (dentro, cerca o alcanzado, y cuándo se renueva).
- **API de Anthropic**: tokens de entrada, salida y caché, con las tarifas públicas de cada modelo.
- **Gemini, Groq, OpenAI, Ollama…**: se cuentan los tokens (incluido el razonamiento). Los servicios cuya tarifa Orbe no conoce salen como «sin precio».
- Se guarda por día en `%APPDATA%\orbe\uso.json` (sin el contenido de las conversaciones). «Poner a cero» borra el historial.

## Configurarlo con Claude Code en tu PC
[`docs/GUIA-CLAUDE-CODE-EN-TU-PC.md`](docs/GUIA-CLAUDE-CODE-EN-TU-PC.md) trae un mensaje listo para pegar en Claude Code (en tu ordenador). Con él, Claude Code revisa la versión, tu `.env` (sin enseñar las claves), prueba la IA, el receptor de avisos y los hooks, crea una tarea de prueba y te da un informe. Los borradores del rediseño de la interfaz están en [`docs/borradores-interfaz/`](docs/borradores-interfaz/).

## Conectores: avisos de Claude Code y otras herramientas
Orbe puede enterarse de lo que hacen otras herramientas y mostrarlo en el personaje. Hoy responde solo con texto, pero esta es la base para conectarlo con más cosas.

1. En la configuración, marca **«Avisos de Claude Code y otras herramientas»** (o pon `ORBE_EVENTOS=1`). Orbe abre un receptor **solo en este equipo** (`127.0.0.1:47821`, o `ORBE_EVENTOS_PUERTO`), protegido con un token secreto que guarda en `%APPDATA%\orbe\conectores.json` y cambia en cada arranque. El receptor solo recibe avisos de texto: no ejecuta nada ni da acceso a Orbe, y rechaza peticiones de páginas web.
2. **Claude Code**: en el menú de la carita → **Actividad**, pulsa **«Copiar los hooks para Claude Code»** y pégalos en `~/.claude/settings.json`. Desde entonces el personaje se pone **concentrado** mientras Claude Code trabaja, **sorprendido** (con un globito) cuando te necesita y **orgulloso** cuando termina. Los avisos aparecen en «Actividad». El script (`resources/conectores/orbe-evento.mjs`) nunca escribe nada ni hace esperar a Claude Code: si Orbe está cerrado, no pasa nada.
3. **Cualquier otra herramienta** (n8n, scripts, copias de seguridad…):
   ```bash
   node orbe-evento.mjs --titulo "Copia de seguridad lista" --tipo terminado --origen backup
   ```
   O una petición HTTP: `POST http://127.0.0.1:47821/v1/eventos` con `Authorization: Bearer <token>` y `{"titulo": "…", "tipo": "inicio|trabajando|esperando|terminado|error|info", "origen": "…", "detalle": "…", "expresion": "risa"}`.

## Cofre cifrado y reglas de permisos (seguridad de los conectores)
Base de seguridad para conectar Gmail, Instagram y Supabase (llegan en las siguientes versiones):

- **Cofre cifrado** (`%APPDATA%orbecofre.bin`): en **Configuración → Conectores** se pegan los tokens y claves de los servicios. Se cifran con `safeStorage` de Electron (DPAPI de Windows, ligado a tu usuario), el campo se vacía al guardar y, si lo copiaste, también el portapapeles. La interfaz solo sabe si un secreto está «Guardado» o «Sin guardar»: **no existe ningún canal para leer un valor**, y nunca van al `.env`, a los registros ni al modelo. Si un secreto guardado apareciera en un aviso de «Actividad», se sustituye por `[secreto]`. Si `cofre.bin` no se puede abrir (otro usuario de Windows, archivo dañado), Orbe no escribe encima.
- **Reglas de permisos** (`%APPDATA%orbe
eglas.json`, se crea solo la primera vez y se relee en cada tarea): cada acción de un conector tiene un modo: `libre` (sin preguntar), `si_lo_pediste` (sin preguntar solo si tu orden la nombraba), `preguntar`, `tu_lo_haces` (Orbe lo deja preparado y lo haces tú) o `bloqueado`. Lo que no esté en el archivo se pregunta.
- **Mínimos que el archivo no puede relajar**: publicar y responder en Instagram siempre piden permiso; enviar correos, seguir, dar me gusta, comentar en cuentas ajenas, borrar publicaciones, compras y contraseñas están bloqueados.

## Gmail (leer y crear borradores)
Orbe puede buscar y leer tu correo y dejarte **borradores** listos; **no puede enviar, borrar ni archivar** (no pide esos permisos a Google, y no existe ninguna herramienta que lo haga).

1. Sigue [`docs/fase3-borradores/02-guia-google.md`](docs/fase3-borradores/02-guia-google.md): proyecto en Google Cloud, Gmail API habilitada, permisos `gmail.readonly` y `gmail.compose`, y un cliente de tipo **App de escritorio**. Guarda su JSON como `%APPDATA%\orbe\google-cliente.json` y reinicia Orbe (las herramientas de Gmail se ofrecen cuando ese archivo existe).
2. **Configuración → Conectores → Gmail → Conectar**. Se abre tu navegador con la pantalla de Google; al aceptar vuelve a `127.0.0.1` (OAuth de escritorio con PKCE) y Orbe guarda el permiso **cifrado en el cofre**. «Revocar» lo borra y avisa a Google.
3. Pide cosas como «resume mi correo de hoy» o «redacta un borrador para responder a Ana». Leer es libre; crear un borrador va sin preguntar solo si tu mensaje lo pedía (`gmail.borrador` = `si_lo_pediste` en `reglas.json`), y si no, pide permiso.

Lo que dice un correo llega al modelo como **datos de terceros**, nunca como instrucciones, y solo en texto (sin HTML, imágenes ni adjuntos; máximo 8000 caracteres por correo).

## Instagram (solo lectura)
Orbe puede consultar el perfil, las publicaciones, las métricas y los comentarios de **tus** cuentas profesionales; **no publica, no responde, no sigue ni da «me gusta»** (no existe ninguna herramienta que lo haga; publicar llegará más adelante y siempre con tu aprobación).

1. Sigue [`docs/fase3-borradores/01-guia-meta.md`](docs/fase3-borradores/01-guia-meta.md): app en Meta Developers en modo desarrollo y tus cuentas con rol en ella. Valen las dos variantes de la API de Instagram: **inicio de sesión unificado** (token `EAA…` de usuario del sistema; permisos `instagram_basic`, `instagram_manage_insights`, `instagram_manage_comments`) e **inicio de sesión de Instagram** (permisos `instagram_business_*`). Orbe distingue el token y habla con el servidor que toca.
2. Genera el token de cada cuenta y pégalo en **Configuración → Conectores → Instagram** (morfy o marca personal), cada uno en su fila. Se guarda **cifrado en el cofre** y no hace falta reiniciar. El de inicio de sesión de Instagram lo renueva Orbe cada 30 días (dura 60); el `EAA…` caduca cuando hayas elegido al crearlo en Meta.
3. Pide cosas como «¿cómo rindieron mis últimos 5 posts de morfy?» o «¿qué comentan en la última publicación de mi marca personal?». Leer es libre (`ig.leer` en `reglas.json`).

Los pies de foto y los comentarios llegan al modelo como **datos de terceros**. Meta puede tardar hasta 48 h en tener las métricas de una publicación nueva.

## Métricas y crecimiento (solo lectura)
La pestaña **Métricas** (icono de tendencia) enseña, por cuenta (morfy y personal): seguidores y cuánto han cambiado en 7 y 30 días, alcance medio, tasa de interacción (interacciones sobre alcance) y las últimas 12 publicaciones, cada una frente a la media de la cuenta (en verde si está por encima, en rojo si está por debajo). Pulsar una publicación la abre en Instagram.

- **Historial propio:** Instagram solo da datos recientes, así que Orbe guarda una foto diaria (seguidores y alcance medio) de cada cuenta conectada en `%APPDATA%\orbe\metricas.json`. La gráfica «Seguidores por día» aparece a partir del segundo día.
- **Analizar con Claude:** manda al chat un encargo de experto en crecimiento de cuentas y marcas personales: diagnóstico con cifras, qué funcionó y por qué, qué dejar de hacer, tres acciones para la semana y dos ideas listas. Usa la herramienta `ig_crecimiento` (libre, `ig.leer`).
- **Informe semanal:** en Tareas hay una plantilla «Informe de crecimiento semanal» (lunes 08:00).
- Requiere el permiso `instagram_manage_insights` en el token; sin él, la pestaña lo dice y enseña solo lo básico («me gusta» y comentarios).

## Composio (cientos de apps por un solo conector)
Orbe se conecta como cliente MCP a [Composio Connect](https://docs.composio.dev/docs/composio-connect.md) (Google Calendar, Notion, Slack, Trello, GitHub…).

1. En [dashboard.composio.dev](https://dashboard.composio.dev) → **AI Clients**, copia tu clave «consumer» y pégala en **Configuración → Conectores → Composio**. Se guarda **cifrada en el cofre** y vale sin reiniciar.
2. Pide en el chat «conecta Google Calendar por Composio»: Orbe te da un enlace y apruebas el acceso tú, en tu navegador.
3. Úsalo hablando normal («¿qué tengo mañana en el calendario?»).

Permisos (`reglas.json`): **leer** (ver, listar, buscar) es libre (`composio.leer`); **todo lo demás** (crear, enviar, publicar, borrar) pide permiso en ese momento (`composio.escribir`, que no se puede bajar de «preguntar»). Lo que devuelve Composio llega al modelo como **datos de terceros**. Ojo: si conectas Gmail en Composio, esa vía sí puede enviar correos tras tu permiso.

## Cómo habla con Claude
Orbe usa un proveedor u otro según `ORBE_PROVEEDOR` (por defecto `auto`):

| Proveedor | Cuándo | Cómo |
|---|---|---|
| `cli` | Por defecto | Lanza `claude -p` en modo headless, sin herramientas, sin tus ajustes ni hooks, y mantiene **un único proceso por conversación** (el propio CLI recuerda el contexto). Usa tu sesión de Claude. Ocupa unos 190 MB mientras hay conversación. |
| `api` | Si hay `ANTHROPIC_API_KEY` en `.env` | SDK oficial `@anthropic-ai/sdk`, en streaming. Orbe guarda el historial y lo reenvía en cada turno. La clave solo existe en el proceso principal. |

| `openai` | `ORBE_PROVEEDOR=openai` | Cualquier servicio compatible con la API de OpenAI (`/chat/completions` en streaming): **Google AI Studio (Gemini)**, OpenAI, OpenRouter, Groq, Ollama, LM Studio… Hacen falta `ORBE_MODELO` y, según el servicio, `ORBE_OPENAI_URL` y `ORBE_OPENAI_KEY`. Las imágenes se envían solo en el mensaje en el que las adjuntas (si el modelo no admite imágenes, el servicio lo dirá). |

El CLI se lanza sin `ANTHROPIC_API_KEY` en su entorno, para que no te cobre por API sin que lo hayas decidido.

Variables del `.env`: `ORBE_PROVEEDOR`, `ORBE_MODELO` (por defecto `claude-sonnet-5-5`), `ORBE_ESFUERZO` (`low`…`max`, por defecto `medium`), `ANTHROPIC_API_KEY`, `CLAUDE_CLI_PATH`, `ORBE_CONTEXTO_MAX` (caracteres de pantalla que se envían, 500–60000, por defecto 8000), `ORBE_ATAJO_PANEL` y `ORBE_ATAJO_LEER` (los atajos globales, en formato de [aceleradores de Electron](https://www.electronjs.org/docs/latest/api/accelerator)), `ORBE_FONDOS` (carpeta con imágenes para el fondo del chat), `ORBE_MEMORIA_MAX` (caracteres de recuerdos que viajan en cada conversación, 1000–12000, por defecto 6000) y `ORBE_MEMORIA_CLAUDE` (de dónde importar la memoria de Claude; carpetas separadas por «;» o «ninguna»). En el modo API, Orbe pide además a Anthropic que, si un clasificador de seguridad rechaza una petición legítima, la reintente en el servidor con el modelo de respaldo recomendado (`fallbacks: "default"`).

## Configuración
La barra lateral solo tiene **Chat, Tareas, Métricas, Personaje y Configuración**. **Consumo, Memoria, Voz y dictado y Fondo del chat** se abren desde la lista de Configuración. Los iconos son SVG propios de Orbe, todos con el mismo trazo; no se usan emojis.

El botón de los controles deslizantes guarda los cambios en el archivo `.env` (el del proyecto, o `%APPDATA%\orbe\.env` en la versión instalada), conserva tus comentarios y reinicia Orbe para aplicarlos. Tiene preajustes para **Google AI Studio (Gemini)**, Groq, NVIDIA, OpenRouter, OpenAI, Ollama y LM Studio. Las claves se escriben ocultas, solo las ve el proceso principal y la pantalla nunca las vuelve a mostrar (solo si hay una guardada); se pueden mantener, cambiar o quitar.

### Google AI Studio (Gemini)
Gemini se usa con su API compatible con OpenAI, con plan gratuito:
1. Entra en [aistudio.google.com](https://aistudio.google.com), pulsa **Get API key** y crea una clave.
2. En Orbe abre la configuración (los controles deslizantes), elige **Otra IA compatible con OpenAI → Google AI Studio (Gemini)**, pega la clave y guarda.

O a mano en el `.env`: `ORBE_PROVEEDOR=openai`, `ORBE_OPENAI_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `ORBE_OPENAI_KEY=<tu clave>` y `ORBE_MODELO=gemini-3.5-flash` (o `gemini-3.8-flash`, más nuevo pero a veces saturado; los alias `…-latest` y la serie 2.5 no funcionan con esta API). Gemini ve imágenes y admite el modo agente. El dictado y la voz neuronal no van por Gemini: configúralos con otro servicio si los quieres.

## Voz
**Leer en voz alta.** Orbe lee las respuestas frase a frase según llegan, se salta los bloques de código (dice que hay uno) y se calla en cuanto empieza otra respuesta, pulsas Esc o la apagas. Por defecto usa las **voces de Windows** (gratis, sin conexión). El botón **Estilo Jarvis** elige la voz masculina en español, la baja de tono y la pone pausada; si has configurado una voz neuronal, la usa. No se puede copiar la voz del actor original: es una voz grave, serena y elegante, no un clon.

**Voz neuronal** (opcional, mucho más natural; se configura en la pantalla de configuración): con `ORBE_TTS_KEY` (o `ORBE_OPENAI_KEY`) Orbe usa `/audio/speech` de un servicio compatible con OpenAI. Ojo: **el texto de las respuestas viaja a ese servicio**. Si falla, sigue con la voz de Windows.

**Dictado**: con `ORBE_STT_KEY` (o `ORBE_OPENAI_KEY`, o solo `ORBE_STT_URL` con un Whisper local) el micrófono graba y, al terminar, envía el audio a `/audio/transcriptions`. Nada se envía mientras grabas ni sin que pulses el micrófono. Orbe solo concede a su ventana el permiso del micrófono (y el de copiar al portapapeles); cualquier otro lo deniega.

Las preferencias de voz se guardan en la ventana de Orbe, no en el `.env`.

## Fondo del chat
Con `ORBE_FONDOS` apuntando a una carpeta con imágenes (PNG o JPEG), Orbe las usa de fondo del panel. Elige una al azar la primera vez y recuerda cuál y cuánto se ve. Un velo oscuro por encima hace que el texto se lea con cualquier imagen. Las originales no se tocan: Orbe guarda una copia reducida (lado mayor de 1600 px, unos 100–250 KB) en su carpeta de datos, así que cambiar de fondo es casi instantáneo aunque las imágenes sean de 4K. Sin la variable, Orbe usa los fondos **incluidos en la instalación** (carpeta `resources/fondos`); si tampoco hay, no hay fondo hasta que elijas uno.

**Elegir imagen…** (Configuración → Fondo del chat) abre el diálogo de Windows para elegir un PNG o JPEG de tu equipo. Orbe la **copia** a `%APPDATA%\orbe\fondos` (nunca pisa un archivo: si el nombre ya existe, la copia lleva la hora delante) y la pone de fondo. **Otro fondo** cambia al azar y la casilla lo apaga.

Los fondos que vienen en `resources/fondos/` (26 imágenes de Solo Leveling reducidas, unos 5 MB) se incluyen en el instalador. Son imágenes con derechos de autor de sus titulares, incluidas aquí para uso personal: si quieres otras, `npm run fondos -- "C:\ruta\a\tus\imagenes"` las reduce y las copia a esa carpeta, y el siguiente `npm run dist` las mete en el `.exe`. Con `ORBE_FONDOS` se usa tu propia carpeta en su lugar.

## Memoria
Orbe recuerda entre sesiones dos cosas: **lo que sabe de ti** y **la conversación que dejaste a medias**.

**Historial del chat (reloj de la cabecera).** «Nueva conversación» ya no borra la actual: la guarda en `%APPDATA%\orbe\conversaciones\` (solo texto). El reloj las lista con su primera pregunta, fecha y número de mensajes, con un buscador por título; al elegir una se reabre y Orbe recibe su contexto con el siguiente mensaje. El buscador mira también dentro de los mensajes.

**Buscar en lo guardado.** Una base local (SQLite, `%APPDATA%\orbe\data\<usuario>\orbe.db`) indexa conversaciones, recuerdos, métricas y contenido; los archivos siguen siendo la fuente. Pregunta «¿qué te dije de…?» y el agente lo busca con `buscar_memoria` y lo resume citando de dónde sale. Cada recuerdo nuevo guarda su origen (el chat de qué día, a mano o de Claude Code), visible en el gestor de memoria.

**Memoria que se ordena sola.** Lo que lleva 90 días sin usarse pierde peso (solo viaja su resumen). Una vez al día Orbe busca recuerdos duplicados o caducados y te avisa; en el gestor eliges «Archivar» (va a `memoria\_archivo`, no se borra) o «Mantener». Las cifras que cambian se vuelven a consultar antes de usarlas.

**Skills y aprendizaje.** Tus skills son texto en `%APPDATA%\orbe\skills\<nombre>\SKILL.md` (sin código; nunca de terceros). Orbe solo ve su nombre y descripción y carga el texto cuando la tarea encaja. Si lo corriges, te propone guardarlo como recuerdo o skill, y al usar una skill puede proponerte mejorarla; nada se guarda sin tu «sí» (tampoco en modo auto) y la versión anterior queda como `anterior-<fecha>.md`.

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

### Texto de una imagen (sin pantallazo)
Para leer el texto que hay **dentro de una imagen** (un cartel, una factura escaneada, un gráfico con rótulos, una foto de una pizarra) sin mandar ninguna imagen, pulsa el botón **[T]** junto al ojo y elige de dónde:

- **De la ventana**: la ventana que estabas usando. Windows entrega la imagen de esa ventana directamente, aunque Orbe u otras ventanas estén encima: **no se fotografía el monitor ni se oculta Orbe**, que sigue en primer plano.
- **Del portapapeles**: copia antes la imagen (clic derecho → «Copiar imagen» en el navegador, o un recorte con Win+Mayús+S). Orbe solo mira el portapapeles al pulsar el botón.
- **De un archivo**: PNG, JPG, BMP, GIF o TIFF.

El texto lo reconoce el **OCR que trae Windows** (`Windows.Media.Ocr`, en `helper/ocr.ps1`), en tu equipo, sin conexión y gratis. Aparece como un chip **«Texto de imagen»** con el texto exacto que se enviará; se suma a lo que haya leído el ojo y se quita con la ×. **Solo viaja el texto, y solo si envías el mensaje**: así sirve también con modelos que no ven imágenes (Groq, Ollama…) y gasta mucho menos que una captura. La imagen no llega a la interfaz; si hace falta una copia temporal para el OCR, se borra al terminar. Como todo lo de la pantalla, al modelo se le dice que ese texto es de terceros.

Necesita el paquete de idioma con «Reconocimiento óptico de caracteres» (viene con Windows en español; si falta: Configuración → Hora e idioma → Idioma y región). La letra a mano o muy decorada se reconoce peor, y el contenido protegido (vídeo con DRM) sale en negro: para ver la imagen de verdad sigue estando la captura.

### Fórmulas matemáticas y estructuras químicas
En el mismo botón **[T]**, cambia arriba a **«Fórmula o química»** y elige la imagen igual que antes (ventana, portapapeles o archivo PNG/JPG). Sirve para ecuaciones, integrales, derivadas, matrices, problemas de física, estructuras moleculares, reacciones…

- Aquí **sí viaja la imagen** (el texto plano del OCR pierde fracciones, exponentes y enlaces químicos), reducida, y solo si envías el mensaje. Antes de enviar ves su miniatura en el chip **«Fórmula»** y puedes quitarla. Sigue sin ser un pantallazo: Orbe no se oculta.
- Si el campo está vacío, Orbe escribe por ti «Reconoce la fórmula o la estructura de la imagen y resuélvela paso a paso»; cámbialo si solo quieres, por ejemplo, transcribirla o comprobar tu resultado.
- La IA primero **transcribe** lo que ve (matemáticas en LaTeX; química con nombre, fórmula molecular y SMILES), avisa de lo que no se lee bien, **resuelve paso a paso** y comprueba el resultado.
- Las respuestas muestran las fórmulas bien escritas con **KaTeX** (`$…$` en línea y `$$…$$` en bloque), sin conexión.
- Necesita un modelo que vea imágenes: Claude (CLI o API), Gemini de Google AI Studio, GPT-4o… Con modelos de solo texto, usa el modo «Texto».

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

## Modo agente (buscar y abrir)
Además de conversar, Orbe puede **actuar**: buscar en internet y leer páginas enteras (con el CLI; `ORBE_DOMINIOS` limita qué dominios lee), **controlar el PC** (ver la ventana como lista numerada de elementos y pulsar, escribir, marcar o desplegar por accesibilidad; ratón y teclado reales solo de respaldo; «Muéstrame cómo» la señala para que lo hagas tú; borde naranja mientras actúa y se para en cuanto tocas el ratón, el teclado o Esc; nunca consolas, contraseñas, bancos ni pagos, y los botones con efecto siempre preguntan; permiso por app en `reglas.json`, p. ej. `pc_spotify.control`), abrir una página en tu navegador y abrir una aplicación por su nombre. Funciona con Claude por el **CLI** (tu sesión, sin clave) o por la **API**, y con servicios compatibles con OpenAI que admitan llamadas a funciones (si el tuyo no las admite, Orbe lo avisa y sigue solo conversando). Se apaga con `ORBE_AGENTE=0`.

- **Qué hace hoy:** `buscar_web` (con el CLI y la API de Claude trae su propia búsqueda; con otros servicios hace falta un buscador, Tavily o SearXNG, ver `.env.example`), `abrir_url` y `abrir_aplicacion`. Cada acción sale como una línea en el chat con sus parámetros y su resultado, el orbe pasa al estado «actuando» y hay un botón **Detener** siempre a mano (en el panel, sobre el orbe plegado, en la bandeja y con Esc). Una tarea tiene un máximo de 15 pasos.
- **Tres niveles:** lo *libre* (buscar, abrir una página o una aplicación de la lista); lo que *pide permiso* en una tarjeta con la acción exacta (lo irreversible, como enviar un formulario); y lo *prohibido*, que no se hace ni con permiso: contraseñas, datos de pago, compras, la configuración de Windows, consolas y scripts. Ante lo prohibido, Orbe se detiene y te pide que lo hagas tú.
- **Lo que viene de fuera es dato, nunca una orden:** resultados de búsqueda y páginas van marcados con una etiqueta única por tarea, y el modelo tiene instrucciones de no obedecer lo que digan y de avisarte.
- **Abrir páginas:** solo `http` y `https`, sin usuario ni contraseña en la dirección y sin llegar a este equipo ni a tu red local (salvo `ORBE_PERMITIR_LOCAL=1`). Solo las abre: el agente no ve la página.
- **Abrir aplicaciones:** por el nombre del menú Inicio (se entienden «calculadora» y «calculator»). El agente solo da un nombre; la ruta con que se abre sale de tu menú Inicio, sin argumentos. Con `%APPDATA%\orbe\aplicaciones.json` pones tus propios nombres o escondes alguna: `{ "alias": { "navegador": "Google Chrome" }, "excluir": ["Nombre"] }`.
- **Con el CLI de Claude** las herramientas viajan por un pequeño servidor local de Orbe (solo accesible desde tu equipo y con un secreto aleatorio); el CLI no puede usar nada más.
- **Plan, revisor y resumen:** si una tarea necesita tres acciones o más, o alguna con permiso, Orbe te enseña primero el plan numerado y espera a que lo apruebes. Cada tarjeta de permiso recuerda tu orden y avisa si antes leyó algo de fuera (una web, Composio). Al terminar sale una línea con el resumen («3 acciones · 2 hechas · 1 no permitida»).
- **Modo auto (el rayo de la cabecera del chat):** encendido, el agente hace todo sin preguntar —también enviar, publicar o borrar— salvo pagos y compras; contraseñas, bancos y consolas siguen bloqueados, y si una web trae órdenes vuelve a preguntarlo todo. Cambia al momento y se recuerda.
- **Ver la página y la pantalla:** `ver_pagina` lee el texto de la web o ventana que tienes abierta; `pc_mirar` captura la ventana en memoria (nunca en disco) para apps sin accesibilidad como Blender, y el agente puede hacer clic sobre esa imagen. La imagen llega al modelo con el CLI y la API de Claude (no con servicios compatibles con OpenAI).
- **Aplicaciones que tardan:** `abrir_aplicacion` espera hasta 10 s a que salga la ventana antes de contestar.
- **Permitir en esta tarea:** en la tarjeta puedes aprobar un tipo de acción para el resto de la tarea. Enviar, publicar, responder, subir o borrar se aprueban siempre una a una.
- **Detener todo y vigilante:** **Ctrl + Mayús + Retroceso** (o «Detener todo» en la bandeja) corta el chat y las tareas de fondo (`ORBE_ATAJO_PAUSA` lo cambia). Orbe se pausa solo y te pregunta si repite la misma acción tres veces o hace doce en un minuto; si una web trae órdenes, desde ahí todo pide permiso.
- **Una sola bandeja de permisos:** lo que piden las tareas de fondo aparece también en la tarjeta del chat.
- **Webs permitidas:** con `ORBE_DOMINIOS=wikipedia.org, gob.es` el agente solo abre esas webs y sus subdominios.
- **Conversaciones largas:** con la API de Claude, la parte antigua se resume sola para no perder el hilo.
- Está pendiente el navegador controlado (leer páginas, hacer clic y escribir), con sus confirmaciones.

## Crear el instalador
```bash
npm ci
npm run iconos     # solo si cambias el diseño del icono (resources/ ya los trae)
npm run dist       # genera en dist/ el instalador, el portable y el .zip
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
   Sube también la rama con la que trabajes; el flujo `ci.yml` ejecuta el tipado y las pruebas en cada subida a `main` y en cada pull request, y **compila los tres instaladores** y los deja para descargar en la sección «Artifacts» de esa ejecución.
4. Publica una versión. Sube una etiqueta y el flujo `release.yml` compila el instalador en un Windows de GitHub, pasa las pruebas y crea la release con el instalador, el portable y el `.zip` adjuntos (también se puede lanzar a mano desde la pestaña *Actions → Publicar instalador → Run workflow*):
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   (La versión de la etiqueta debe coincidir con la de `package.json`: el nombre del instalador sale de ahí.) También puedes subirlo a mano: `gh release create v1.0.0 dist/Orbe-Setup-1.0.0.exe --generate-notes`.

No hay secretos en el repositorio: `.env` está en `.gitignore` y el flujo solo usa el `GITHUB_TOKEN` que GitHub da a cada ejecución. Orbe no incluye actualizaciones automáticas: para actualizar, instala el nuevo `.exe` encima.

## Pruebas
`npm test` ejecuta unas 1200 pruebas, sin gastar nada: la lógica pura (parser del protocolo del CLI, errores, configuración, limpieza y recorte del texto de pantalla, formato de las notas de memoria, filtro de datos delicados y órdenes «recuerda que…»), el almacén y el importador de memoria sobre carpetas temporales, el proveedor del CLI contra un CLI de mentira (`tests/falso-claude.mjs`), el proveedor de la API contra un servidor SSE local, el cliente del lector de pantalla contra un lector de mentira (`tests/falso-helper.mjs`) y los puentes IPC (que el contexto solo se adjunte si lo pides, que se restaure si el envío falla y que nadie ajeno a la ventana de Orbe pueda usarlos).

`npm run humo` arranca la aplicación con un chat, un lector de pantalla, una captura y una memoria de mentira (notas e imágenes de ejemplo, nunca tu memoria ni tu pantalla reales), recorre el orbe, el chat, la lectura de pantalla (leer, ver, quitar chips, enviar, avisos, errores y el atajo) la memoria (gestor, notas, datos delicados, «recuerda que…», deshacer, conversación repuesta e interruptor) la captura (sugerencias, confirmación, vista previa, envío y errores) y el texto de imagen (menú, chip, envío, quitar y errores, comprobando que Orbe no se oculta), guarda capturas en `humo/` y termina con código 1 si algo falla.

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
src/main/pantalla  lector de pantalla: cliente del helper, limpieza, prioridad de fuentes, captura, texto de imagen (OCR), contexto pendiente, IPC
src/main/conectores avisos de otras herramientas: bus de actividad, receptor local, hooks de Claude Code
src/main/conectores/gmail  Gmail: OAuth de escritorio (loopback + PKCE) y cliente de la API (buscar, leer, borradores)
src/main/conectores/instagram  Instagram: cliente de solo lectura (perfil, publicaciones, métricas, comentarios) y renovación del token
src/main/cofre     cofre cifrado de secretos (safeStorage/DPAPI): almacén, validación e IPC sin canal de lectura
src/main/metricas   métricas: lectura por cuenta, medias, historial diario (metricas.json) e IPC
src/main/agente/reglas.ts  reglas de permisos de los conectores (reglas.json) y sus mínimos fijos
src/renderer/personaje personaje: 3D (three.js, ojos de luz, detalle de pelo y tejido), dibujado (SVG), Rive, director de expresiones, sonidos, menú
src/main/memoria   memoria: almacén de notas, importador de Claude, filtro de secretos, bloque del prompt, conversación guardada, IPC
helper             lector de pantalla de Windows (PowerShell + C#, UI Automation) y OCR de Windows (ocr.ps1)
src/preload        puente seguro hacia la interfaz
src/renderer       interfaz: orbe (WebGL2 + GLSL con ruido simplex), panel de chat y chips de contexto
src/shared         tipos compartidos
scripts            herramientas (probar-uia, generar-iconos)
resources          iconos (icon.ico, icon.png, tray.png)
.github/workflows  integración continua y publicación del instalador
electron-builder.yml  configuración del instalador
tests              pruebas unitarias (vitest) e integración opcional
```

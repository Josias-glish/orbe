# Configurar y probar Orbe con Claude Code en tu PC

Esta guía es para que **Claude Code en tu ordenador con Windows** revise, pruebe y configure Orbe por ti: la versión, la IA (Gemini o Claude), los avisos de Claude Code, las tareas de fondo y el consumo.

## Cómo usarla

1. Abre una terminal (PowerShell) en cualquier carpeta, por ejemplo `C:\Users\<tú>\Proyectos`.
2. Ejecuta `claude`.
3. Copia **todo el bloque de abajo** (desde «Eres mi ayudante…» hasta el final) y pégalo como primer mensaje.
4. Acepta los permisos que te pida. Antes de tocar un archivo de configuración, te enseñará el cambio.

---

```text
Eres mi ayudante para dejar funcionando Orbe, mi asistente de escritorio (Electron, Windows), en ESTE ordenador.
Repositorio: https://github.com/Josias-glish/orbe (rama main). Versión objetivo: 1.4.0 o posterior.
Trabaja paso a paso, con PowerShell, y al terminar dame un informe en una tabla (paso, resultado, qué hiciste).

REGLAS
- Nunca muestres, copies ni escribas en el chat el valor de ninguna clave (ORBE_OPENAI_KEY, ANTHROPIC_API_KEY,
  ORBE_STT_KEY, ORBE_TTS_KEY) ni el token de %APPDATA%\orbe\conectores.json. Como mucho di «hay una clave guardada».
- Antes de modificar un archivo, haz una copia con la fecha (p. ej. settings.json.bak-20261109) y enséñame el diff.
- Si algo falla, explica la causa en una frase y propón el arreglo. No sigas a ciegas.
- No borres nada de %APPDATA%\orbe (memoria, conversación, tareas, consumo).

PASO 1 · Versión instalada
- Busca Orbe.exe (normalmente en "$env:LOCALAPPDATA\Programs\orbe" o "$env:LOCALAPPDATA\Programs\Orbe"; si no, búscalo en
  el disco con Get-ChildItem -Recurse -Filter Orbe.exe -ErrorAction SilentlyContinue, limitado a C:\Users y C:\Program Files).
- Lee su versión: (Get-Item <ruta>).VersionInfo.ProductVersion
- Si es menor que 1.4.0: descarga «Orbe-Setup-<versión>.exe» de la última release de
  https://github.com/Josias-glish/orbe/releases (usa `gh release download --repo Josias-glish/orbe --pattern "Orbe-Setup-*.exe"`
  si tengo gh; si no, Invoke-WebRequest con la URL del archivo). Cierra Orbe (menú de la bandeja → Salir, o
  Stop-Process -Name Orbe) y pregúntame antes de ejecutar el instalador.

PASO 2 · Configuración (%APPDATA%\orbe\.env)
- Si no existe, dímelo: se crea desde la configuración de Orbe (botón de los controles deslizantes) o copiando
  .env.example del repositorio.
- Lista las variables SIN sus valores secretos: para cada línea NOMBRE=valor, muestra el nombre y el valor solo si
  el nombre no termina en KEY. Para las claves, di «guardada» o «vacía».
- Comprueba:
  * Si ORBE_PROVEEDOR=openai y la URL es de Google (generativelanguage.googleapis.com/v1beta/openai), ORBE_MODELO debe
    ser gemini-3.5-flash (o gemini-3.8-flash). Los alias «*-latest» y la serie 2.5 NO funcionan con esa API: si los
    tiene, propón cambiarlo a gemini-3.5-flash.
  * ORBE_EVENTOS=1 (necesario para los avisos de Claude Code). Si falta, propón añadirlo.
- Tras cualquier cambio, pide que reinicie Orbe (o hazlo tú: Stop-Process -Name Orbe y vuelve a abrir Orbe.exe).

PASO 3 · ¿Responde la IA?
- Si es Gemini u otra compatible con OpenAI: lee ORBE_OPENAI_URL, ORBE_OPENAI_KEY y ORBE_MODELO del .env en variables
  de PowerShell (sin imprimirlas) y haz UNA llamada:
  POST <URL>/chat/completions con cabecera Authorization: Bearer <clave> y cuerpo
  {"model":"<modelo>","messages":[{"role":"user","content":"Responde solo: hola"}]}
  Enséñame solo el código HTTP y el texto de la respuesta. 400 con «API key» = clave mala; 404 = modelo que no existe;
  429 = sin cuota; 503 = saturado (prueba otro modelo o más tarde).
- Si es el CLI de Claude: ejecuta `claude --version` y `claude -p "Responde solo: hola"`.

PASO 4 · Receptor de avisos de Orbe
- Con Orbe abierto y ORBE_EVENTOS=1, comprueba que existe %APPDATA%\orbe\conectores.json.
- Lee puerto y token (sin mostrarlos) y llama a GET http://127.0.0.1:<puerto>/v1/estado con Authorization: Bearer <token>.
  Debe responder {"ok":true,"app":"orbe"}.
- Manda un aviso de prueba:
  node "$env:APPDATA\orbe\conectores\orbe-evento.mjs" --titulo "Prueba desde Claude Code" --tipo terminado --origen prueba
  Pregúntame si el conejo hizo una reverencia y salió el aviso en el menú de la carita → Actividad.
- Si no hay Node.js (node --version falla), dímelo: hace falta para los hooks (winget install OpenJS.NodeJS.LTS).

PASO 5 · Hooks de Claude Code (que Orbe vea lo que hace Claude Code)
- Abre %USERPROFILE%\.claude\settings.json (créalo con {} si no existe) y haz una copia de seguridad.
- AÑADE (sin borrar lo que ya haya) estos hooks. La ruta del script es la real expandida de
  %APPDATA%\orbe\conectores\orbe-evento.mjs, escrita en JSON con barras dobles \\:
  SessionStart, UserPromptSubmit, Notification, Stop, SubagentStop, SessionEnd → [{ "hooks": [ORDEN] }]
  PreToolUse → [{ "matcher": "*", "hooks": [ORDEN] }]
  donde ORDEN = { "type": "command", "command": "node \"<ruta>\" --claude-code", "timeout": 5 }
  Si ya hay hooks para esos eventos, añade ORDEN a su lista; no dupliques si ya está.
- Valida que el JSON es correcto (Get-Content ... | ConvertFrom-Json).
- Dime que abra una sesión nueva de Claude Code en otra terminal: el conejo debe ponerse curioso al empezar,
  concentrado mientras trabaja y orgulloso al terminar.

PASO 6 · Tareas de fondo y consumo (como los agentes «siempre encendidos»)
- Pídeme que en Orbe pulse el botón del reloj (Tareas) → «+ Nueva», escriba «Dime la hora y una frase motivadora
  corta», elija «Ahora, una vez» y pulse «Hacer ahora».
- Espera 1 minuto y lee %APPDATA%\orbe\tareas.json: la tarea debe tener en historial[0] estado "completada" y un
  resultado. Si es "error", enséñame el texto del resultado y dime la causa probable.
- Lee %APPDATA%\orbe\uso.json y resume el consumo de hoy por modelo (tokens y dólares). Es normal que Gemini salga
  «sin precio»: es gratis.
- Pídeme que abra el botón del gráfico (Consumo) y confirme que veo lo mismo.

PASO 7 · Informe
- Tabla final: Versión · IA · Receptor · Hooks · Tareas · Consumo, con ✅/❌ y una línea de qué hiciste o qué falta.
- Si algo quedó pendiente, dime exactamente qué tengo que hacer yo (un paso por línea).
```

---

## Qué comprueba cada paso

| Paso | Qué mira | Archivos |
|---|---|---|
| 1 | Que tengas Orbe 1.4.0 o posterior | `Orbe.exe`, releases de GitHub |
| 2 | Que el modelo y los avisos estén bien puestos, sin enseñar tus claves | `%APPDATA%\orbe\.env` |
| 3 | Que tu clave y tu modelo respondan de verdad | La API de tu servicio |
| 4 | Que el receptor local (`127.0.0.1`, con token) esté abierto | `%APPDATA%\orbe\conectores.json` |
| 5 | Que Claude Code avise a Orbe en cada paso | `%USERPROFILE%\.claude\settings.json` |
| 6 | Que una tarea de fondo se haga sola y que se cuente el consumo | `tareas.json`, `uso.json` |

## Si algo falla

- **«Please pass a valid API key»** (400): la clave del `.env` no es la de Google AI Studio, o le sobra un espacio. Créala de nuevo en aistudio.google.com → Get API key.
- **404 «no longer available»**: el modelo ya no existe para cuentas nuevas. Usa `gemini-3.5-flash`.
- **No existe `conectores.json`**: falta `ORBE_EVENTOS=1`, o Orbe no se reinició después de ponerlo.
- **El conejo no reacciona a Claude Code**: la ruta del hook no coincide con la real, o no tienes Node.js. Ejecuta el comando del hook a mano para verlo.

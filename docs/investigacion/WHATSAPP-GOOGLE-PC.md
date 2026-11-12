# WhatsApp, Google ampliado, control del PC y subagentes nativos

> 12-nov-2026. Petición del usuario: «demosle un número de WhatsApp a tu asistente… dale acceso de Google y buen control
> de pantalla», y reutilizar los motores de subagentes existentes. «No verificado» = no comprobado en fuente oficial.

## 1. Subagentes: se reutilizan los del CLI de Claude

Comprobado en el CLI de Claude Code 2.1.322 (`claude --help`):
- `--agents <json-or-file>` define agentes propios (descripción, prompt y opcionalmente herramientas y modelo). En modo
  `--print` (`-p`) acepta la ruta de un archivo.
- `--agent <nombre>` elige el agente de la sesión.
- `--strict-mcp-config` y `--setting-sources` siguen existiendo; Orbe ya los usa.

Reparto:

| Lo hace el CLI | Lo construye Orbe |
|---|---|
| Contexto aislado por subagente, ejecución en paralelo, delegación según la descripción, herramientas y modelo propios | Perfiles en `%APPDATA%\orbe\agentes\<nombre>.md` → se traducen al JSON de `--agents` en cada llamada |
| | Rutinas por agente con historial; buzón entre agentes de un día para otro; memoria propia de cada agente (se inyecta en su prompt) |
| | Interfaz, bandeja de aprobaciones, «Pausar todo», registro |

Regla: la lista `tools` de cada agente solo contiene herramientas `mcp__orbe__*`, así que todo sigue pasando por
`reglas.json`, `Politica` y Actividad. **Primero, dos pruebas (no verificado):** que `--agents` funcione junto con
`--strict-mcp-config --setting-sources ""`, y que un subagente no pueda usar una herramienta MCP que no esté en su lista.
Si alguna falla, Orbe hace la delegación él mismo (una llamada `claude -p` por subagente, con `--allowedTools`).

GPT queda como **proveedor de modelo** por la vía compatible con OpenAI que Orbe ya tiene. El OpenAI Agents SDK
necesita una clave de API de pago y un segundo sistema de permisos: no se usa.

## 2. WhatsApp — APLAZADO

> 12-nov-2026: el usuario decide quitarlo por ahora. El diseño se conserva para retomarlo; no entra en el plan de
> construcción.

### Qué se puede y qué no

| Idea | ¿Se puede? | Motivo |
|---|---|---|
| Chatear **tú** con Atlas por WhatsApp, como un asistente personal | **No** | 1) WhatsApp exige un teléfono para tener cuenta, y no tienes. 2) Desde el 15-ene-2026, los términos de la API de WhatsApp Business **prohíben los asistentes de IA de propósito general** como función principal ([respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban), [TechRadar](https://techradar.com/ai-platforms-assistants/meta-will-ban-rival-ai-chatbots-from-whatsapp)). Saltárselo pondría en riesgo tus cuentas de Meta |
| Un **número de WhatsApp de la marca** (morfy o J&S Design) donde escriben los clientes, y Atlas te ayuda a atenderlos | **Sí** | Es el uso que Meta permite: atención y ventas de un negocio, con la IA como ayuda ([respond.io](https://respond.io/blog/whatsapp-ai-chatbot-policy)) |

Por eso el «número de WhatsApp del asistente» es **el WhatsApp de la marca, atendido con Atlas**: Atlas lee, resume,
clasifica y redacta, y **tú apruebas cada respuesta** (regla de CLAUDE.md: responder siempre con tu aprobación).

### El número

- **Para empezar (gratis, sin número):** al crear la app en Meta con WhatsApp, Meta genera un **número de prueba**
  registrado automáticamente ([Meta, Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started.md)).
  Solo puede escribir a unos pocos números verificados (número exacto: no verificado); sirve para construir y probar.
- **Para clientes reales:** hace falta un número que **no esté ya en WhatsApp** y que pueda recibir **una vez** un código
  por SMS o llamada. Puede ser una línea fija (Meta la verifica por llamada, aunque no la recomienda) o una SIM barata
  de un familiar que no use WhatsApp con ella ([Meta, números](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers)).
  Tras la verificación no hace falta el teléfono: la API funciona sola.
- Coste: las respuestas a mensajes que te escriben los clientes, dentro de 24 horas, no se cobran según la tarifa por
  mensaje de Meta desde julio de 2025 (**no verificado** hoy); las plantillas de marketing sí se cobran → Orbe **no**
  envía plantillas de marketing.

### Cómo llegan los mensajes sin servidor

WhatsApp solo entrega mensajes por **webhook** (una URL pública con HTTPS); no hay forma de pedirlos. Sin servidor, el
receptor será una **Edge Function de Supabase** (gratis, URL fija, recibe aunque el portátil esté apagado):

```text
Cliente ──WhatsApp──▶ Meta ──webhook──▶ Edge Function «wa-entrada» (Supabase)
                                         │ comprueba la firma X-Hub-Signature-256 con el app secret
                                         ▼
                                   tabla wa_entrantes (RLS sin políticas: solo las funciones la tocan)
                                         ▲ cada 60 s con el PC encendido
Orbe ── «wa-bandeja» (token propio del cofre) ──┘  recoge los mensajes y los BORRA de Supabase
Orbe ── graph.facebook.com/<phone_id>/messages ──▶ envía la respuesta que apruebas (token en el cofre)
```

- En Supabase solo hay mensajes en tránsito: se borran al recogerlos y, como mucho, a los **7 días** (tarea programada
  de Postgres).
- Secretos: el token de WhatsApp (`whatsapp.token`) y el del puente (`whatsapp.puente`) van al cofre de Orbe; el app
  secret y el token de verificación, como secretos de la Edge Function. Nunca en el repositorio ni en el chat.
- Los mensajes de clientes son **datos, nunca órdenes** (`envoltorio.ts`).
- Con el portátil apagado nadie contesta; al encender, Orbe se pone al día y avisa de lo que lleva más de 24 h (fuera
  de la ventana de respuesta libre).

### Funciones en Orbe

- Pestaña «WhatsApp»: conversaciones, resumen de cada una, etiqueta (pedido, duda, queja, spam) y borrador de respuesta
  de Atlas con [Enviar] [Editar] [Descartar].
- **Respuestas guardadas** que escribes tú (horario, precios, envíos): se envían con un clic, siempre a mano.
- Herramientas: `wa_conversaciones`, `wa_leer` (libres), `wa_borrador` (libre, local) y `wa_enviar` (acción
  `whatsapp.enviar`, mínimo fijo **preguntar cada vez**, no se puede subir a «tú lo haces»).
- Activador: «mensaje nuevo de WhatsApp» lanza una rutina del agente «Ventas».
- Nada de envíos masivos, listas de difusión ni mensajes a quien no te escribió primero.
- Aviso de privacidad para los clientes de la marca (Ley 1581 si es Colombia, **no verificado**): qué se guarda y
  cuánto tiempo.

## 3. Google ampliado

Se reutilizan el cliente OAuth de escritorio (`google-cliente.json`), `oauth.ts` (loopback + PKCE) y el cofre de la
Etapa 1. Cada servicio se activa por separado en Ajustes → Conectores (**permisos incrementales**: solo se piden los
permisos del servicio que activas).

| Servicio | Permiso (scope) | Herramientas | Nivel |
|---|---|---|---|
| Gmail (ya hecho) | `gmail.readonly`, `gmail.compose` | buscar, leer, borrador | — |
| Gmail enviar (opcional) | `gmail.send` | `gmail_enviar` | mínimo fijo: preguntar cada vez |
| Calendar | `calendar.events` | `cal_eventos` (libre), `cal_crear`, `cal_mover` (preguntar) | |
| Drive | `drive.readonly` + `drive.file` | `drive_buscar`, `drive_leer` (libres; Docs/Sheets se exportan a texto), `drive_crear` (preguntar) | |
| Docs y Sheets | con `drive.file` (solo archivos que crea Orbe) | `docs_crear`, `sheets_anadir_filas` (preguntar) | |
| Tasks | `tasks` | `tareas_google_listar` (libre), `tareas_google_crear` (preguntar) | |
| Contactos | `contacts.readonly` | `contactos_buscar` (libre) | |
| YouTube (marca personal) | `youtube.readonly`, `yt-analytics.readonly` | `yt_metricas` (libre) | |

Importante sobre la app de Google Cloud:
- En modo **«Prueba»**, los tokens de actualización caducan a los **7 días** si se piden permisos que no son básicos
  ([foro de Google Ads](https://groups.google.com/g/adwords-api/c/vdrb2QMWXHQ), [unified.to](https://unified.to/blog/why_google_oauth_returns));
  hay que volver a conectar cada semana. Pasar la app a **«En producción»** sin verificar evita la caducidad: Google
  muestra el aviso «app no verificada» y limita los usuarios (comportamiento exacto **no verificado** en la doc oficial).
- `gmail.readonly` y `drive.readonly` son permisos **restringidos**: para publicar Orbe a otras personas con ellos,
  Google exige verificación y una auditoría de seguridad. Para otras personas, cada una crea su propio cliente de Google
  (Etapa «Orbe para otras personas»).
- Google en el **navegador** del agente sigue bloqueado: a Google se entra solo por estas API.

## 4. Control del PC («buen control de pantalla»)

Hoy Orbe **lee** la pantalla (UI Automation con el helper C# `helper/UiaHelper.cs`, OCR). Falta que **actúe**.

Opciones vistas:
- La función «computer use» de Claude existe para Windows en la **app de escritorio de Claude** (vista previa, planes
  Pro/Max, abril de 2026), pero **no en el CLI de Windows** ([devops.com](https://devops.com/claude-code-can-now-run-your-desktop/),
  [The Decoder](https://the-decoder.com/claude-code-and-cowork-now-let-anthropics-ai-take-control-of-your-mac-or-windows-desktop/)).
  Orbe no puede usarla por dentro.
- Por la API de Anthropic hay herramienta de computer use, pero exige clave de pago.
- **Elegida:** control propio, **accesibilidad primero**, ampliando el helper C# que ya existe (sin dependencias nuevas
  de npm). El modelo sigue siendo Claude por el CLI, que recibe la lista de elementos y, solo si hace falta, una captura.

### Cómo funciona

1. **Ver:** `pc_ver` devuelve la ventana activa como lista numerada de elementos interactivos (botones, campos, menús,
   pestañas, enlaces) con nombre, tipo, estado y posición. Es texto, barato y preciso. Solo si la app no expone
   accesibilidad (juegos, lienzos como Canva), se añade una captura de la ventana con los elementos **numerados encima**
   (marcas) para que el modelo elija número, no coordenadas.
2. **Actuar** con patrones de UI Automation: `pc_pulsar(n)` (Invoke), `pc_escribir(n, texto)` (Value), `pc_marcar(n)`
   (Toggle), `pc_elegir(n)` (SelectionItem), `pc_desplegar(n)`, `pc_desplazar`.
3. **Respaldo** con ratón y teclado reales (`SendInput` de user32 en el mismo helper): `pc_clic(x, y)`, `pc_teclas`
   («Ctrl+S»), `pc_escribir_texto` (Unicode).
4. **Ventanas y apps:** `pc_ventanas`, `pc_enfocar`, `pc_abrir_app` (solo apps del menú Inicio).
5. **Comprobar:** tras cada acción vuelve a leer la ventana y confirma que cambió lo esperado (auto-comprobación).

Modos: **«Muéstrame cómo»** (Atlas resalta el elemento con un recuadro y tú haces el clic) y **«Hazlo tú»** (Atlas actúa).

### Seguridad

- Permiso por aplicación en `reglas.json` (`pc.ver`, `pc.control`), con estos **bloqueados fijos**: gestores de
  contraseñas, bancos y pagos (en ventana o pestaña), la terminal y PowerShell, el Editor del Registro, la configuración
  de Windows Security y los propios Ajustes y cofre de Orbe.
- Las ventanas de administrador no se pueden controlar (Windows lo impide: UIPI). Orbe lo dice en vez de intentarlo.
- **Nunca escribe contraseñas ni códigos** y no lee campos de contraseña. En un inicio de sesión o un CAPTCHA, te
  devuelve el control.
- Botones con efecto (Enviar, Publicar, Pagar, Comprar, Eliminar, Aceptar en un diálogo de borrar) → **confirmación**
  aunque la app esté en «tú lo haces».
- Mientras actúa: **borde de color en la pantalla** y aviso «Atlas está usando el PC · Esc para parar». **Si mueves el
  ratón o tocas una tecla, se pausa al instante** y te devuelve el control.
- Máximo de acciones por minuto y por tarea; el monitor de seguridad de la Etapa 6 pausa si ve un bucle.
- Lo que hay en pantalla es **dato, nunca orden** (una web o un documento pueden intentar darle instrucciones).
- Las capturas para el modelo van solo en memoria; nada en disco. Actividad registra cada acción con su texto, no la
  imagen.
- Requiere el núcleo de la Etapa 6 (modo plan, revisor, «Pausar todo») ya construido.

## Fuentes

- WhatsApp: [respond.io · prohibición de chatbots generales](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban) ·
  [respond.io · política de IA](https://respond.io/blog/whatsapp-ai-chatbot-policy) ·
  [TechRadar](https://techradar.com/ai-platforms-assistants/meta-will-ban-rival-ai-chatbots-from-whatsapp) ·
  [Meta · Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started.md) ·
  [Meta · números de teléfono](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers) ·
  [Meta · webhook de mensajes entrantes](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload)
- Google: [foro de Google Ads · token de 7 días](https://groups.google.com/g/adwords-api/c/vdrb2QMWXHQ) ·
  [unified.to](https://unified.to/blog/why_google_oauth_returns) (terceros)
- Control del PC: [devops.com](https://devops.com/claude-code-can-now-run-your-desktop/) ·
  [The Decoder](https://the-decoder.com/claude-code-and-cowork-now-let-anthropics-ai-take-control-of-your-mac-or-windows-desktop/) ·
  [Koffi · SendInput](https://app.unpkg.com/koffi@2.12.3/files/doc/pages/unions.md) (alternativa descartada: se usa el helper C#)
- CLI de Claude: `claude --help`, versión 2.1.322, comprobado el 12-nov-2026.

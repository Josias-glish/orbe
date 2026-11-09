# Configuración (borrador)

## 1. Nuevas líneas para `.env.example`

Las **claves y tokens no van en el `.env`**: se guardan cifrados en el cofre de Orbe (Ajustes → Conectores). En el `.env`
solo hay datos no secretos.

```ini
# ───────── Conectores (Fase 4) ─────────
# Interruptor general: sin esto, Orbe no consulta ni publica nada en ningún servicio.
ORBE_CONECTORES=1

# Gmail (API de Gmail con OAuth de escritorio). El archivo lo descargas de Google Cloud (guía 02).
ORBE_GMAIL=1
ORBE_GMAIL_CLIENTE=%APPDATA%\orbe\google-cliente.json
# Cada cuántos minutos se miran correos nuevos (5–60).
ORBE_GMAIL_INTERVALO=5

# Instagram (API con inicio de sesión de Instagram). Los tokens van al cofre, no aquí.
ORBE_IG=1
ORBE_IG_APP_ID=000000000000000
# Versión de la API de Meta: compruébala en developers.facebook.com/docs/graph-api/changelog
ORBE_IG_VERSION=v25.0
# Nombres internos de tus cuentas (los tokens se guardan con estos nombres). Añade «personal» si tu marca personal
# tiene su propia cuenta de Instagram (tiene que ser profesional: Empresa o Creador).
ORBE_IG_CUENTAS=jsdesign,morfy,personal
# Tope propio de publicaciones por cuenta y día (Meta permite 50; nos quedamos muy por debajo).
ORBE_IG_MAX_DIA=5
# Cada cuántos minutos se miran comentarios y mensajes (5–60).
ORBE_IG_INTERVALO=10

# Supabase (alojamiento temporal de imágenes). La clave secreta va al cofre.
ORBE_SUPABASE_URL=https://xxxxxxxx.supabase.co
ORBE_SUPABASE_BUCKET=orbe-medios
# Minutos que dura el enlace firmado que descarga Meta (5–60).
ORBE_SUPABASE_ENLACE_MIN=15

# Contenido con Claude CLI + Claude Design
# png = Claude Design exporta PNG a contenido\entrada\<marca>\ (por defecto)
# exportado = el CLI genera HTML con tu sistema de diseño y Orbe lo convierte en PNG (respaldo)
ORBE_DESIGN_MODO=png
# Marcas (carpetas en contenido\marcas\). «personal» es tu marca personal.
ORBE_MARCAS=jsdesign,morfy,personal
# Alias del CLI para cada trabajo: el texto y el diseño piden más calidad; el revisor, rapidez.
ORBE_CONTENIDO_MODELO=sonnet
ORBE_REVISOR_MODELO=haiku

# Navegador propio del agente (Etapa 6). msedge viene con Windows; chrome si lo tienes instalado.
ORBE_NAVEGADOR=0
ORBE_NAVEGADOR_CANAL=msedge
```

## 2. Cofre cifrado: `%APPDATA%\orbe\cofre.bin`

Generado por Orbe con `safeStorage` (DPAPI de Windows, ligado a tu usuario). Contenido una vez descifrado (nunca se
escribe así en disco):

```json
{
  "version": 1,
  "secretos": {
    "gmail.refresh": "…",
    "ig.jsdesign": { "token": "…", "renovado": "2026-11-20T10:00:00Z" },
    "ig.morfy":    { "token": "…", "renovado": "2026-11-20T10:00:00Z" },
    "ig.app_secret": "…",
    "supabase.secret": "sb_secret_…"
  }
}
```

## 3. Reglas de permisos: `%APPDATA%\orbe\reglas.json`

Cuatro comportamientos, como en dots: `libre` (sin preguntar), `si_lo_pediste` (sin preguntar solo si lo pediste
explícitamente en esa orden), `preguntar` y `tu_lo_haces` (Orbe prepara todo y te lo pasa). Más `bloqueado`.

```json
{
  "version": 1,
  "reglas": [
    { "accion": "gmail.leer",             "modo": "libre" },
    { "accion": "gmail.borrador",         "modo": "si_lo_pediste" },
    { "accion": "ig.leer",                "modo": "libre" },
    { "accion": "ig.publicar",            "modo": "preguntar" },
    { "accion": "ig.responder_comentario","modo": "preguntar" },
    { "accion": "ig.responder_mensaje",   "modo": "preguntar" },
    { "accion": "ig.ocultar_comentario",  "modo": "preguntar" },
    { "accion": "ig.borrar_comentario",   "modo": "tu_lo_haces" },
    { "accion": "navegador.leer",         "modo": "libre" },
    { "accion": "navegador.escribir",     "modo": "preguntar" },
    { "accion": "navegador.enviar",       "modo": "preguntar" },
    { "accion": "navegador.comprar",      "modo": "bloqueado" }
  ],
  "bloqueadas_siempre": [
    "cambiar contraseñas o correos de recuperación",
    "pagos y compras",
    "borrar cuentas o publicaciones",
    "escribir en campos de contraseña",
    "seguir, dar me gusta o comentar en cuentas ajenas"
  ]
}
```

`ig.publicar` **no se puede poner en `libre`**: Orbe lo ignora y lo deja en `preguntar` (protección contra suspensiones).

## 4. Ficha de marca: `%APPDATA%\orbe\contenido\marcas\<marca>\marca.md`

Una por marca: `jsdesign`, `morfy` y `personal`. En la personal, el tono es el tuyo (primera persona) y los pilares
suelen ser: lo que aprendes, lo que construyes (J&S Design, morfy, Orbe), y tu día a día como estudiante emprendedor.

Plantilla para rellenar (la usa Claude en todos los textos):

```markdown
# morfy

## Qué es
(Una frase: qué vendes u ofreces y a quién.)

## Público
- Edad, intereses, dónde viven, qué problema les resuelves.

## Tono
- 3 adjetivos (p. ej. cercano, directo, creativo).
- Tuteo / usted:
- Emojis: sí, máx. 2 por post / no.

## Palabras y frases
- Sí: …
- Nunca: …

## Pilares de contenido (3–5)
1. …

## Llamadas a la acción preferidas
- «Escríbenos por DM», «Link en la bio», …

## Hashtags fijos (máx. 5)
#…

## Ejemplos de posts que te gustaron (pega el texto)
1. …
```

## 5. Almacén de contenido: `%APPDATA%\orbe\contenido\contenido.json`

```json
{
  "version": 1,
  "piezas": [
    {
      "id": "p_8f2c",
      "marca": "morfy",                   // jsdesign | morfy | personal
      "estado": "borrador",              // idea | borrador | aprobada | programada | publicada | error
      "formato": "imagen",                // imagen | carrusel | reel
      "idea": "3 errores al elegir colores para tu marca",
      "pie": "…", "hashtags": ["#…"],
      "archivos": ["piezas/p_8f2c/1.png"], // PNG exportados de Claude Design
      "programada_para": "2026-11-12T18:00:00-05:00",
      "aprobada_por_ti": null,            // fecha de tu aprobación; sin esto nunca se publica
      "ig": { "media_id": null, "permalink": null },
      "metricas": [ { "a_las": "24h", "views": 0, "reach": 0, "likes": 0, "comments": 0, "shares": 0, "saved": 0 } ]
    }
  ]
}
```

## 6. Tareas predefinidas (se crean desactivadas; tú las activas)

| Nombre | Cuándo | Qué hace |
|---|---|---|
| Plan semanal de contenido | Lunes 16:00 | Métricas de 30 días → 3–5 ideas por marca → calendario en «Contenido» |
| Métricas de publicaciones | Cada día 20:00 | Guarda las métricas de las publicaciones de hace 1, 7 y 30 días |
| Resumen de correo | Cada día 7:00 | Resumen de correos nuevos; «solo si hay algo» |
| Comentarios pendientes | Cada 2 h | Propone respuestas a comentarios nuevos; «solo si hay algo» |

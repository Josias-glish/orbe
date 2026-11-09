# Guía 4 · Claude Design + Claude CLI

Objetivo: que cada imagen de Instagram salga con **tu identidad visual** (la de Claude Design), generada por el CLI de
Claude con tu suscripción, sin usar la API. **Tres marcas**: J&S Design, morfy y tu **marca personal**.

> Cambio aprobado (Fase 3): Claude Design **exporta en PNG** y Orbe usa esos PNG tal cual. La conversión HTML → PNG
> de Orbe queda solo como respaldo si un diseño llega en HTML.

## Qué está verificado y qué no

| Dato | Estado |
|---|---|
| Claude Design exporta a .zip, PDF, PPTX, HTML independiente y «handoff» a Claude Code | Verificado (centro de ayuda de Claude) |
| Claude Code tiene `/design` (importar un diseño) y `/design-sync` (sincronizar el sistema de diseño) | Verificado (página de producto) |
| Esos comandos funcionan en modo no interactivo (`claude -p`) | **No verificado** |
| Exportación a PNG por mesa de trabajo (artboard) | Verificado en la documentación de artefactos de Claude Code; en el menú *Export* de Claude Design **no verificado** (no aparece en su lista). Si en tu cuenta no sale «PNG», usa el respaldo HTML |

Por eso el diseño **no depende** de que `/design` funcione sin pantalla: Claude Design exporta los PNG (o, si tu cuenta
no lo ofrece, HTML) a una carpeta que Orbe vigila.

## Paso 1 · Tu marca en Claude Design (una vez por marca)

1. En claude.ai → **Design** → crea un proyecto `Marca J&S Design`.
2. Pídele: «Crea el sistema de diseño de J&S Design para Instagram: colores, tipografías, logotipo, estilos de titular,
   y 4 plantillas de post 1080×1350 (anuncio, consejo, carrusel portada, carrusel interior)». Ajusta hasta que te guste.
3. **Export → Standalone HTML** (o **.zip**). Guarda el resultado en:
   `%APPDATA%\orbe\contenido\marcas\jsdesign\design\`
4. Repite con morfy → `...\marcas\morfy\design\`.
5. Repite con tu **marca personal** → `...\marcas\personal\design\`. Para esta, pídele a Claude Design un sistema
   de marca personal: tu nombre como logotipo, una foto tuya de referencia (opcional), 2 colores y 1 tipografía, y
   plantillas de «reflexión», «proceso / detrás de cámaras» y «logro».

Cuando cambies tu marca en Claude Design, vuelve a exportar y sustituye la carpeta. Orbe detecta el cambio.

## Paso 2 · Cada post en PNG (modo por defecto: `ORBE_DESIGN_MODO=png`)

1. Orbe te propone la pieza en «Contenido»: idea, texto de la imagen y pie (lo escribe el CLI de Claude).
2. Pulsas **Diseñar en Claude Design**: Orbe copia al portapapeles un encargo listo para pegar en tu proyecto de
   marca («Diseña un post 1080×1350 con la plantilla X y este texto…») y abre claude.ai/design.
3. En Claude Design, cuando te guste: **Export → PNG** y guarda en
   `%APPDATA%\orbe\contenido\entrada\<marca>\` (Orbe te muestra esa carpeta con un botón).
4. Orbe detecta el PNG en segundos, comprueba que mide 1080×1350, 1080×1080 o 1080×1920 y pesa menos de 8 MB, y lo
   pone en la pieza. Varios PNG con el mismo prefijo (`post-1.png`, `post-2.png`…) forman un **carrusel**.
5. Apruebas → Supabase → Instagram (como en el resto del plan).

## Paso 2b · Respaldo automático (`ORBE_DESIGN_MODO=exportado`)

Sin pasar por Claude Design en cada post: el CLI genera el HTML con tu sistema de diseño exportado y Orbe lo
convierte en PNG. Útil para piezas sencillas o si un día Claude Design no está disponible.

Para cada publicación, Orbe lanza el CLI así (borrador; ver [06-codigo.md](06-codigo.md) §6):

```
claude -p --output-format stream-json --model sonnet \
  --setting-sources "" --strict-mcp-config --mcp-config <servidor MCP de Orbe> \
  --allowedTools "Read,mcp__orbe__contenido_guardar_diseno" --permission-mode dontAsk \
  --add-dir "%APPDATA%\orbe\contenido\marcas\morfy\design" \
  --system-prompt <prompt «diseñador» de 07-prompts.md>
```

- Solo puede **leer** la carpeta de tu marca y **guardar** el HTML del post. No puede escribir en otro sitio, ni usar la
  consola, ni internet.
- Devuelve un HTML de 1080×1350 con estilos en línea y fuentes de tu marca.

## Paso 3 · HTML → PNG (Orbe, en tu PC)

Orbe abre el HTML en una **ventana oculta sin acceso a internet ni JavaScript**, la captura a 1080×1350 y guarda el PNG.
Así el resultado es idéntico a lo que ves en la vista previa.

## Paso 4 · Alternativa manual (siempre disponible)

Si prefieres diseñar tú en Claude Design: exporta el post como HTML a
`%APPDATA%\orbe\contenido\entrada\` y Orbe lo convertirá en PNG y lo pondrá en la cola de aprobación con el texto que
Claude proponga.

## Si en el futuro `/design` funciona sin pantalla

Se añadirá una opción `ORBE_DESIGN_MODO=handoff` para que el CLI importe el diseño directamente. Hasta verificarlo, el
modo por defecto es `ORBE_DESIGN_MODO=exportado` (pasos 1–3).

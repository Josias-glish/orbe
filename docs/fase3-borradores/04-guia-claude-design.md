# Guía 4 · Claude Design + Claude CLI

Objetivo: que cada imagen de Instagram salga con **tu identidad visual** (la de Claude Design), generada por el CLI de
Claude con tu suscripción, sin usar la API.

## Qué está verificado y qué no

| Dato | Estado |
|---|---|
| Claude Design exporta a .zip, PDF, PPTX, HTML independiente y «handoff» a Claude Code | Verificado (centro de ayuda de Claude) |
| Claude Code tiene `/design` (importar un diseño) y `/design-sync` (sincronizar el sistema de diseño) | Verificado (página de producto) |
| Esos comandos funcionan en modo no interactivo (`claude -p`) | **No verificado** |
| Exportación directa a PNG desde Claude Design | **No verificado** (no aparece en la lista de formatos) |

Por eso el diseño **no depende** de que `/design` funcione sin pantalla: usamos lo que sí está verificado (exportar
HTML/zip) y Orbe convierte el HTML en PNG él mismo.

## Paso 1 · Tu marca en Claude Design (una vez por marca)

1. En claude.ai → **Design** → crea un proyecto `Marca J&S Design`.
2. Pídele: «Crea el sistema de diseño de J&S Design para Instagram: colores, tipografías, logotipo, estilos de titular,
   y 4 plantillas de post 1080×1350 (anuncio, consejo, carrusel portada, carrusel interior)». Ajusta hasta que te guste.
3. **Export → Standalone HTML** (o **.zip**). Guarda el resultado en:
   `%APPDATA%\orbe\contenido\marcas\jsdesign\design\`
4. Repite con morfy → `...\marcas\morfy\design\`.

Cuando cambies tu marca en Claude Design, vuelve a exportar y sustituye la carpeta. Orbe detecta el cambio.

## Paso 2 · Cómo lo usa el CLI (automático)

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

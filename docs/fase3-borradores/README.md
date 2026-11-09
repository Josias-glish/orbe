# Fase 3 · Borradores (sin ejecutar)

> Estado: **APROBADO** (9-nov-2026) con tres cambios: marca personal, PNG desde Claude Design e identidad Atlas.
> Fase 4 en construcción, por etapas.
>
> Antes: Nada de esto está conectado a Orbe todavía. El código vive en estos documentos, no en
> `src/`, y no se ejecuta hasta que apruebes la Fase 4.

## Decisiones que recogen estos borradores

| Decisión | Origen |
|---|---|
| Claude se usa **solo por el CLI** (`claude -p`), con tu suscripción. No se usa la API de Anthropic. | Tu indicación de la Fase 3 |
| El diseño de cada publicación sale de **Claude Design**, que **exporta en PNG**; el HTML → PNG de Orbe es solo respaldo | Tu indicación (aprobación de la Fase 3) |
| **Tres marcas**: J&S Design, morfy y tu **marca personal** | Tu indicación (aprobación de la Fase 3) |
| **Atlas**: identidad propia de mayordomo digital (ya construida en la v1.5.0) | Tu indicación (aprobación de la Fase 3) |
| Las imágenes se suben a **Supabase Storage** (bucket privado + enlace firmado de 15 min) | Tu indicación; Meta exige una URL pública |
| Instagram se publica con la **API oficial de Meta** (Instagram Login, Standard Access) | Plan aprobado |
| Correo: **API de Gmail con OAuth**, solo leer y crear borradores | Plan aprobado |
| **Navegador propio** del agente (Etapa 6) incluido | Tu aprobación |

## Supuestos (corrígeme si alguno es falso)

1. Dos cuentas profesionales de Instagram: J&S Design y morfy.
2. Gmail personal (no Workspace).
3. Claude Code instalado en tu PC con tu sesión iniciada.
4. Tienes cuenta en Supabase (en esta sesión aparece conectada una).

## Flujo completo de una publicación

```
 Tú / tarea del lunes
        │  «Haz 3 posts para morfy esta semana»
        ▼
 ┌────────────────────┐   lee métricas (solo lectura, sin preguntar)
 │ Orbe → Claude CLI  │◄──────────────────────────── Instagram API
 │ (claude -p + MCP)  │
 └────────┬───────────┘
          │ 1. idea + texto (CLI) → encargo para Claude Design
          ▼
 ┌────────────────────┐
 │ Claude Design      │  tu proyecto de marca (J&S Design, morfy o personal) → Export PNG
 └────────┬───────────┘  (respaldo: el CLI hace HTML y Orbe lo convierte en PNG sin internet)
          │ Orbe detecta el PNG en contenido\entrada\<marca>\ y comprueba tamaño y peso
          │ 2. vista previa en la pestaña «Contenido»  ──►  TÚ APRUEBAS ✅ (o pides cambios)
          ▼
 ┌────────────────────┐
 │ Supabase Storage   │  bucket privado «orbe-medios» → enlace firmado de 15 min
 └────────┬───────────┘
          │ 3. Meta descarga la imagen desde ese enlace
          ▼
 ┌────────────────────┐
 │ Instagram API      │  /media → espera FINISHED → /media_publish
 └────────┬───────────┘
          │ 4. se borra la imagen de Supabase · se guarda el id de la publicación
          ▼
   Métricas a las 24 h, 7 d y 30 d → informe de Claude
```

## Índice

| Archivo | Contenido |
|---|---|
| [01-guia-meta.md](01-guia-meta.md) | Paso a paso en Meta Developers (app, testers, tokens) |
| [02-guia-google.md](02-guia-google.md) | Paso a paso en Google Cloud (Gmail API, OAuth de escritorio) |
| [03-guia-supabase.md](03-guia-supabase.md) | Proyecto, bucket privado y clave secreta |
| [04-guia-claude-design.md](04-guia-claude-design.md) | Cómo conectar tu marca de Claude Design con el CLI |
| [05-configuracion.md](05-configuracion.md) | Variables del `.env`, archivos de reglas, fichas de marca |
| [06-codigo.md](06-codigo.md) | Código de cada módulo (borrador) |
| [07-prompts.md](07-prompts.md) | Prompts del administrador de contenido y del revisor |
| [08-pruebas.md](08-pruebas.md) | Cómo se probará cada etapa y criterios de «terminado» |

## Orden de construcción (Fase 4)

0. Seguridad (cofre, reglas, registro) → 1. Gmail → 2. Instagram lectura → 3. Contenido (CLI + Claude Design + render) →
4. Publicación (Supabase + Meta) → 5. Funciones tipo dots → 6. Navegador propio.

Cada etapa sale en su propia versión de Orbe (1.5.0, 1.6.0…) con instalador, para que puedas probarla antes de seguir.

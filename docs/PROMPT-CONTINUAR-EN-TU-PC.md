# Seguir construyendo Orbe con Claude Code en tu PC

## Preparar el portátil (una sola vez)

En PowerShell:

```powershell
winget install Git.Git OpenJS.NodeJS.LTS GitHub.cli
npm install -g @anthropic-ai/claude-code
gh auth login                      # inicia sesión en GitHub en el navegador
cd $HOME\Proyectos                 # o la carpeta que prefieras
gh repo clone Josias-glish/orbe
cd orbe
npm ci
claude                             # inicia sesión con tu cuenta de Claude la primera vez
```

Claude Code lee solo el archivo `CLAUDE.md` del repositorio, con todo el contexto del proyecto. Después, pega el prompt
de abajo como primer mensaje.

---

```text
Actúa como arquitecto de software e ingeniero principal del proyecto Orbe (este repositorio). Responde siempre en
español, con tono formal y directo, sin relleno.

CONTEXTO
- Lee primero CLAUDE.md completo, después docs/fase3-borradores/README.md y el archivo del borrador de la etapa en
  la que vamos a trabajar. Son la fuente de verdad: el plan y los borradores ya están APROBADOS (Fase 4: construcción).
- Estás en mi portátil con Windows: puedes ejecutar Orbe de verdad (npm run dev), probar safeStorage (DPAPI), OAuth
  con 127.0.0.1, Edge, notificaciones de Windows y la API real de Meta/Google/Supabase con MIS cuentas.

TAREA
Construye la siguiente etapa pendiente de «Estado y siguiente trabajo» de CLAUDE.md (empieza por la Etapa 0 si no está
hecha). Para cada etapa:
1. Resume en 5 líneas qué vas a construir y qué archivos tocarás, y espera mi «adelante».
2. Crea una rama claude/<etapa> desde main actualizado.
3. Implementa siguiendo el borrador (docs/fase3-borradores/06-codigo.md y 07-prompts.md), adaptándolo al código real.
4. Escribe pruebas vitest. Ejecuta npm run typecheck, npm test y npm run humo; revisa las capturas de humo/.
5. Pruébalo de verdad en este PC conmigo: dime paso a paso qué tengo que hacer (por ejemplo, generar un token en Meta
   y guardarlo en Ajustes → Conectores) y comprueba el resultado.
6. Sube la versión (npm version X.Y.Z --no-git-tag-version), actualiza README y CLAUDE.md (sección de estado),
   haz commit, push y abre una pull request en borrador con gh. Lanza la release con
   gh workflow run release.yml --ref <rama> y dame los enlaces cuando esté publicada.
7. Detente y espera mi aprobación antes de la siguiente etapa.

REGLAS
- Nunca me pidas, muestres ni escribas en el chat contraseñas, tokens ni claves. Si necesitas uno, dime dónde
  generarlo y cómo guardarlo en Orbe (cofre cifrado) o en %APPDATA%\orbe\.env. No los leas para enseñarlos.
- No publiques nada en Instagram, no envíes correos y no subas archivos a Supabase sin que yo lo apruebe en ese momento.
- Respeta las políticas de Meta y Google; nada que pueda suspender mis cuentas.
- No borres nada de %APPDATA%\orbe (memoria, tareas, consumo, conversación). Haz copia antes de tocar un archivo de ahí.
- Si algo falla, explica la causa en una frase y propón el arreglo; no sigas a ciegas ni desactives pruebas.
- Cita fuentes oficiales para cualquier dato de APIs y marca como «no verificado» lo que no compruebes.
- Máximo 3 preguntas si te falta información.

Empieza leyendo CLAUDE.md y dime en qué etapa estamos.
```

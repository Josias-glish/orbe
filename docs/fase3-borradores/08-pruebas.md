# Pruebas y criterios de «terminado» (borrador)

Cada etapa se entrega como una versión de Orbe con instalador. Pruebas automáticas (vitest) aquí, en el repositorio;
pruebas reales (tus cuentas) en tu PC, guiadas por Claude Code con una guía como `docs/GUIA-CLAUDE-CODE-EN-TU-PC.md`.

| Etapa | Pruebas automáticas | Prueba real en tu PC | Terminado cuando… |
|---|---|---|---|
| 0 Seguridad | Cofre cifra/descifra; `estado()` no devuelve valores; reglas: mínimos no relajables, desconocido = preguntar | Guardar y borrar un secreto de prueba desde Ajustes | Ningún secreto aparece en `.env`, registros ni interfaz |
| 1 Gmail | OAuth con servidor falso (estado, PKCE, tiempo agotado); parseo de correos multiparte; borrador en base64url | Conectar, «resume mi correo de hoy», crear un borrador y verlo en Gmail | El borrador aparece en Gmail y no se envía nada |
| 2 IG lectura | Cliente con respuestas falsas de Meta (incluye errores 190 token caducado, 4 límite) | «¿Cómo rindieron mis últimos 5 posts de morfy?» | Las cifras coinciden con las de la app de Instagram |
| 3 Contenido | Render: bloquea URLs externas, tamaño 1080×1350; argumentos del CLI sin herramientas extra | Generar 1 post de cada marca con tu export de Claude Design | Te gusta el diseño sin tocarlo más de 2 veces |
| 4 Publicación | Publicador: sin aprobación lanza error; borra de Supabase aunque Meta falle; límite diario | Publicar 1 post real con aprobación; comprobar que Supabase queda vacío | Publicado, con enlace guardado y Supabase vacío |
| 5 Tipo dots | Revisor: BLOQUEAR impide la petición; activadores no duplican avisos | Comentario de prueba desde otra cuenta → propuesta de respuesta | Llega aviso y propuesta en < 15 min |
| 6 Navegador | `permitido()`: bloquea Meta, Google, bancos, red local; campo contraseña = error | «Busca el horario de la biblioteca X» | Lo encuentra sin tocar sitios bloqueados |

## Riesgos de la Fase 4 y respuesta

| Riesgo | Qué haremos |
|---|---|
| `/design` no funciona sin pantalla | Ya previsto: modo `exportado` por defecto |
| Meta cambia permisos o métricas | Versión de la API configurable; errores claros en Actividad |
| El render no carga tus fuentes | Las fuentes deben venir dentro del export (carpeta de la marca); si no, se avisa |
| Plan gratuito de Supabase pausado | Aviso en Orbe con el enlace para reactivarlo |

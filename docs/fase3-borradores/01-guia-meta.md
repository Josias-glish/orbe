# Guía 1 · Meta Developers (Instagram)

Tiempo estimado: 45–60 min. Se hace una sola vez. **No pegues ningún token en el chat.**

> Los nombres de los menús de Meta cambian a menudo. Si alguno no coincide, busca el equivalente; el orden de los pasos
> es lo que importa. Lo marcado como (no verificado) no pude comprobarlo en la documentación actual.

## 0. Requisitos

- Las dos cuentas de Instagram en modo **profesional** (Empresa o Creador):
  Instagram web → Configuración → *Tipo de cuenta y herramientas* → *Cambiar a cuenta profesional*.
- Tu cuenta de Meta Developers con acceso (ya la tienes).

## 1. Crear la app

1. https://developers.facebook.com/apps → **Crear app**.
2. Nombre: `Orbe Contenido`. Correo de contacto: el tuyo.
3. Caso de uso: **Administrar mensajes y contenido en Instagram** (*Manage messaging & content on Instagram*).
4. Portafolio comercial: «No quiero conectar un portafolio todavía» (se puede después).
5. Crear. La app queda en **modo desarrollo**, que es justo lo que queremos: solo funciona con cuentas que tengan rol en ella.

## 2. Configurar la API con inicio de sesión de Instagram

1. Panel de la app → *Casos de uso* → *Personalizar* el de Instagram → **Configuración de la API con inicio de sesión de Instagram**.
2. Anota (sin compartirlos) el **ID de la app de Instagram** y la **clave secreta de la app de Instagram**. Van al `.env` (ver [05-configuracion.md](05-configuracion.md)).
3. En *Permisos*, añade:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
   - `instagram_business_manage_comments`
   - `instagram_business_manage_messages`
   - `instagram_business_manage_insights`

## 3. Dar rol a tus dos cuentas

1. Panel → *Roles de la app* → *Roles* → **Añadir personas** → **Evaluador de Instagram** → escribe el usuario de J&S Design. Repite con morfy.
2. Acepta la invitación desde cada cuenta: Instagram web → Configuración → *Apps y sitios web* → *Invitaciones de evaluador* → Aceptar. (Ubicación exacta: no verificado.)

## 4. Generar los tokens

1. Panel → configuración de la API de Instagram → **Generar identificadores de acceso** → *Añadir cuenta* → inicia sesión con J&S Design → concede los permisos.
2. Pulsa *Generar token*. Se muestra **una sola vez**: cópialo al portapapeles.
3. **No lo pegues en el chat.** En Orbe: Ajustes → Conectores → Instagram → *Guardar token de J&S Design*. Se cifra con
   el cifrado de Windows y se borra del portapapeles. Esa pantalla llega en la Etapa 0, antes que el conector, así que
   no hace falta guardarlo en ningún otro sitio. Si generas el token antes de tenerla, simplemente vuelve a generarlo
   después (generar uno nuevo no rompe nada).
4. Repite con morfy.

Estos tokens son de **larga duración (60 días, no verificado)**. Orbe los renueva solo cada 30 días con
`GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`. Si el portátil pasa más de 60 días
apagado, hay que generar uno nuevo (paso 4).

## 5. Comprobación

Orbe hará `GET https://graph.instagram.com/me?fields=user_id,username,account_type` con cada token. Debe responder el
usuario y `account_type` = `BUSINESS` o `MEDIA_CREATOR`.

## Qué NO hacer (para evitar suspensiones)

- No pidas *Advanced Access* ni revisión: no la necesitas y expone la app.
- No añadas cuentas que no sean tuyas.
- No uses herramientas que sigan cuentas, den «me gusta» o comenten automáticamente.
- No automatices la web de Instagram con el navegador del agente (Orbe lo bloquea: ver [06-codigo.md](06-codigo.md) §8).

## Webhooks

No se configuran: necesitan un servidor HTTPS público. Orbe consulta comentarios y mensajes cada 5–10 min mientras el
portátil esté encendido.

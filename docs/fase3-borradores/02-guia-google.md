# Guía 2 · Google Cloud (Gmail)

Tiempo estimado: 30–45 min. Se hace una sola vez. **No pegues claves ni códigos en el chat.**

## 1. Proyecto

1. https://console.cloud.google.com → selector de proyecto → **Proyecto nuevo** → nombre `orbe-correo` → Crear.
2. *APIs y servicios* → *Biblioteca* → busca **Gmail API** → **Habilitar**.

## 2. Pantalla de consentimiento (Google Auth Platform)

1. *Google Auth Platform* → *Comenzar*.
2. Nombre de la app: `Orbe`. Correo de asistencia: el tuyo.
3. Público: **Externo**.
4. *Acceso a datos* → *Añadir permisos*:
   - `https://www.googleapis.com/auth/gmail.readonly` (leer)
   - `https://www.googleapis.com/auth/gmail.compose` (crear borradores)
   - **No** añadas `gmail.send`, `gmail.modify` ni `https://mail.google.com/`.
5. *Público* → **Publicar app** → estado **En producción**.
   - Por qué: en modo *Prueba* el permiso caduca a los 7 días.
   - Google la marcará como «no verificada»: es normal para uso personal (límite de 100 usuarios; solo serás tú).
   - **No envíes la app a verificación.**

## 3. Credenciales

1. *Clientes* → **Crear cliente** → tipo **App de escritorio** → nombre `Orbe escritorio`.
2. **Descargar JSON** → guárdalo como `%APPDATA%\orbe\google-cliente.json`.
   (En apps de escritorio Google no considera secreto este archivo, pero igualmente no lo compartas ni lo subas a git.)

## 4. Conectar (desde Orbe 1.7.0)

1. Reinicia Orbe (para que vea `google-cliente.json`) → Configuración → Conectores → Gmail → **Conectar**.
2. Se abre tu navegador con la pantalla de Google. Verás «Google no ha verificado esta app» →
   *Configuración avanzada* → *Ir a Orbe (no seguro)*. Es tu propia app.
3. Marca los dos permisos → Continuar. El navegador dirá «Ya puedes volver a Orbe».
4. Orbe guarda el permiso cifrado. Puedes revocarlo cuando quieras en https://myaccount.google.com/permissions.

## Qué hace y qué no

| Hace | No hace |
|---|---|
| Lee y resume correos | Enviar correos (no tiene permiso) |
| Avisa de correos importantes (consulta cada 5 min) | Borrar o archivar correos |
| Crea **borradores** que tú revisas y envías desde Gmail | Seguir instrucciones escritas dentro de un correo |

## Riesgos

- Si cambias la contraseña de Google, el permiso se invalida: vuelve a pulsar *Conectar*.
- Si no usas Orbe en 6 meses, el permiso caduca.

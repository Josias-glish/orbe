# Sitio web: registro para novedades y protocolo de datos

> Decidido por el usuario el 12-nov-2026: las personas se registran en la web para recibir las novedades de Orbe y de
> los proveedores de IA. El desarrollador **solo guarda el registro**. Rama: `claude/sitio-web`
> (https://orbe-olive.vercel.app/). «No verificado» = no comprobado. **Esto no es asesoría legal.**

## 1. Qué se construye

| Pieza | Cómo |
|---|---|
| Registro e inicio de sesión | **Enlace mágico por correo** (Supabase Auth, sin contraseñas): no hay contraseñas que se puedan filtrar, y pulsar el enlace confirma que el correo es suyo (doble confirmación) |
| Datos guardados | Tabla `suscriptores`: `user_id`, `correo`, `acepta_novedades` (sí/no), `version_politica`, `fecha_consentimiento`. **Nada más**: ni nombre, ni teléfono, ni datos de Orbe |
| Zona de usuario («Mi cuenta») | Ver qué datos hay, cambiar preferencias, **darse de baja** y **borrar la cuenta** (borra la fila y el usuario de Auth al momento) |
| Baja con un clic | Enlace en cada correo de novedades, sin iniciar sesión |
| Envío de novedades | Proveedor de correo (Resend: capa gratuita citada de 3.000 correos/mes y 100/día, **no verificado**) usado también como SMTP de Supabase Auth |
| Política | `sitio/privacidad.html` actualizada con el protocolo de abajo, conservando intacta la parte de Gmail (Google la revisa) |

Seguridad:
- Row Level Security en `suscriptores`: cada persona solo ve y cambia su fila. La clave `service_role` solo vive en
  una Edge Function (borrar cuenta, enviar novedades), nunca en el navegador ni en el repositorio.
- La librería de Supabase se sirve desde el propio sitio (como three.js), no desde un CDN.
- Sin analítica ni rastreadores; contra bots, un campo trampa (*honeypot*) y el límite de envíos de Auth.
- Supabase recomienda SMTP propio para producción: el remitente por defecto es «best-effort», solo para pruebas.

**Orbe (la app) no envía nada a la web.** No hay cuenta dentro de Orbe. El aviso de versión nueva consulta la API
pública de GitHub Releases, sin identificador ni datos de quien la usa.

## 2. Antes de publicar (importante)

1. **Edad y responsable.** Si vives en Colombia, la Ley 1581 de 2012 regula los datos personales: hace falta una
   autorización previa e informada, una política de tratamiento y atender los derechos de las personas. Además, el
   tratamiento de datos de **menores** está restringido y lleva participación de sus representantes. Recomendación: que
   un **adulto responsable** (padre, madre o tutor) figure como responsable del tratamiento o lo revise contigo, y que
   el registro pida tener **18 años o el permiso de un representante**. **No verificado** en qué país estás ni qué ley
   aplica: confírmalo.
2. **Si te escriben desde la UE**, aplica también el RGPD (consentimiento, derecho de supresión, encargados de
   tratamiento). **No verificado** si tendrás usuarios allí.
3. **Encargados del tratamiento** que hay que nombrar en la política: Supabase (base de datos y Auth), el proveedor de
   correo y Vercel (alojamiento).

## 3. Protocolo de tratamiento de datos (borrador para `privacidad.html`)

Rellenar lo que va entre `[ ]`.

```text
PROTOCOLO DE TRATAMIENTO DE DATOS PERSONALES — ORBE
Última actualización: [fecha] · Versión [n]

1. Responsable
[Nombre del responsable o de su representante legal], [ciudad, país]. Contacto: [correo de contacto].

2. Qué datos recogemos
Solo si te registras en este sitio: tu correo electrónico, la fecha en que aceptaste esta política, su versión y si
quieres recibir novedades. Nada más.
La aplicación Orbe no nos envía ningún dato: tus conversaciones, archivos, métricas, imágenes y claves se quedan en
tu ordenador o van directamente a los proveedores que tú configures.

3. Para qué
a) Enviarte novedades de Orbe (versiones nuevas, informes de novedades) y de los proveedores de IA que usa.
b) Permitirte entrar en «Mi cuenta» para ver, cambiar o borrar tus datos.
No vendemos, alquilamos ni cedemos tus datos. No hacemos perfiles ni publicidad. No usamos analítica ni rastreadores.

4. Base
Tu consentimiento, que das al registrarte y puedes retirar cuando quieras.

5. Cuánto tiempo
Mientras sigas registrado. Si te das de baja o borras tu cuenta, tus datos se eliminan al momento de nuestra base de
datos; las copias de seguridad del proveedor se borran en su ciclo normal ([plazo del proveedor]).

6. Quién nos ayuda (encargados)
Supabase (base de datos e inicio de sesión), [proveedor de correo] (envío de correos) y Vercel (alojamiento del
sitio). Solo tratan tus datos para prestarnos ese servicio.

7. Tus derechos
Conocer, actualizar, rectificar y suprimir tus datos, y revocar tu autorización: desde «Mi cuenta», con el enlace de
baja de cada correo o escribiendo a [correo de contacto]. Respondemos en un máximo de [n] días hábiles.

8. Menores de edad
Si eres menor de [18 / edad aplicable], necesitas la autorización de tu padre, madre o representante legal para
registrarte.

9. Seguridad
Sin contraseñas (inicio de sesión por enlace al correo), conexión cifrada, acceso restringido a la base de datos y
ningún dato de la aplicación en nuestros servidores.

10. Cambios
Si cambiamos esta política, te avisaremos por correo y te pediremos aceptarla de nuevo si cambia para qué usamos tus
datos.
```

## Fuentes

- [Supabase · SMTP de Auth](https://supabase.com/docs/guides/auth/auth-smtp) ·
  [Supabase · lista de comprobación para producción](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Decreto 1377 de 2013 (reglamenta la Ley 1581 de 2012)](https://sidn.ramajudicial.gov.co/SIDN/NORMATIVA/TEXTOS_COMPLETOS/5_DECRETOS/DECRETOS%202013/Decreto%201377%20de%202013%20(Por%20el%20cual%20se%20reglamenta%20parcialmente%20la%20Ley%201581%20de%202012).pdf)
  · [SIC sobre datos de menores](https://sedeelectronica.sic.gov.co/sites/default/files/normatividad/022019/Rad18_18267888PDG.PDF)
- [Resend · precios 2026](https://costbench.com/software/email-api/resend/free-plan/) (terceros, no verificado)

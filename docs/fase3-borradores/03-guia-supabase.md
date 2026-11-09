# Guía 3 · Supabase (alojamiento temporal de imágenes)

Tiempo estimado: 15 min. Plan gratuito. **No pegues la clave en el chat.**

## Por qué Supabase

Meta no acepta que le subas la imagen desde tu PC: la descarga desde una URL. Supabase Storage da esa URL sin servidor
propio. Usaremos un **bucket privado** y un **enlace firmado que caduca a los 15 minutos**: la imagen solo es accesible
mientras Meta la descarga, y después se borra.

## 1. Proyecto aparte

1. https://supabase.com/dashboard → **New project** → nombre `orbe-medios` → región cercana (p. ej. São Paulo o US East)
   → genera una contraseña de base de datos y guárdala en tu gestor de contraseñas (Orbe no la necesita).
2. Proyecto **dedicado solo a esto**: si la clave se filtrara, no afectaría a tus otros proyectos.

## 2. Bucket privado

1. *Storage* → **New bucket** → nombre `orbe-medios` → **Public bucket: desactivado**.
2. *Restrict file size*: 10 MB. *Allowed MIME types*: `image/png, image/jpeg, video/mp4`.
3. No hace falta crear políticas (RLS): Orbe usa la clave secreta, que las ignora, y nadie más accede.

## 3. Claves

1. *Project Settings* → *API Keys*.
2. Copia la **URL del proyecto** (`https://xxxx.supabase.co`): va en `ORBE_SUPABASE_URL` (no es secreta).
3. Crea una **Secret key** nueva llamada `orbe-escritorio` (`sb_secret_…`). Guárdala en Orbe → Ajustes → Conectores →
   Supabase → *Guardar clave*. Se cifra con Windows. **Nunca** la pongas en un repositorio ni en el chat.

## 4. Mantenimiento

- Orbe borra cada imagen tras publicarla. Una vez al día borra también lo que tenga más de 24 h (por si falló algo).
- Plan gratuito: los proyectos inactivos se pausan tras una semana sin uso (no verificado si sigue vigente). Si se pausa,
  Orbe te avisará y lo reactivas desde el panel.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Fuga de la clave secreta | Proyecto dedicado, clave cifrada, revocable en 1 clic |
| Imagen accesible por terceros | Bucket privado; enlace de 15 min; borrado tras publicar |

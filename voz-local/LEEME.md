# Voz neuronal local con Kokoro (gratis, sin clave, sin internet)

Un servidor pequeño en tu PC que habla con la API `/audio/speech` de OpenAI, para que Orbe lea las respuestas con
[Kokoro](https://github.com/thewh1teagle/kokoro-onnx), un modelo de voz neuronal de código abierto con voces en español
(`em_alex`, `em_santa`, `ef_dora`). No necesita Docker.

## Instalar (una vez)
Hace falta Python 3.10–3.13 (el 3.14 aún no tiene todas las piezas). Desde una carpeta nueva fuera de OneDrive, con estos
tres archivos de `voz-local/` dentro:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install kokoro-onnx
curl.exe -L -O https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl.exe -L -O https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```
(El modelo pesa unos 310 MB y las voces 27 MB.)

## Usar
1. Doble clic en `iniciar-voz.cmd` (arranca en segundo plano; tarda unos segundos). `detener-voz.cmd` lo para.
2. En Orbe: configuración (controles deslizantes) → *Voz neuronal* → **Kokoro en tu PC** → Guardar.
3. En el altavoz de la cabecera, **Motor de voz → Voz neuronal**.

Va a ritmo de lectura con una CPU de 8 núcleos o más; en equipos más lentos habrá pausas entre frases. Solo escucha en
`127.0.0.1`, rechaza peticiones de páginas web y no envía nada a internet.

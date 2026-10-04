# Orbe

Asistente de escritorio flotante para Windows 11. Un orbe fluido (shaders WebGL) siempre visible en una esquina que se abre como panel de chat con Claude y, solo cuando se lo pides, entiende lo que tienes en pantalla.

> Estado: **fase 1 de 5** (ventana flotante y orbe animado). El chat, el contexto de pantalla, la captura y la bandeja llegan en las siguientes fases.

## Requisitos
- Windows 11
- Node.js 22.12 o superior (probado con 24)
- Para el chat (fase 2): el CLI `claude` instalado y con la sesión iniciada, o una `ANTHROPIC_API_KEY` en `.env`

## Instalación
```bash
npm install
```
La primera vez que se ejecuta, Electron descarga su binario (unos 100 MB).

## Uso
```bash
npm run dev      # desarrollo, con recarga en caliente y selector de estados del orbe
npm run build    # compila a out/
npm run start    # ejecuta la versión compilada
npm test         # pruebas unitarias
npm run humo     # prueba de humo: arranca, recorre los estados y guarda capturas en humo/
```

## Controles (fase 1)
- **Clic** en el orbe: abrir o cerrar el panel.
- **Arrastrar** el orbe (o la cabecera del panel): moverlo. Recuerda su última posición.
- **Ctrl + Mayús + Espacio**: abrir o cerrar el panel desde cualquier aplicación.
- Con `npm run dev` aparece, con el panel abierto, una barra para forzar los estados del orbe (reposo, leyendo, pensando, respondiendo).

## Estructura
```
src/main       proceso principal (ventana, atajos, ajustes)
src/preload    puente seguro hacia la interfaz
src/renderer   interfaz y orbe (WebGL2 + GLSL con ruido simplex)
src/shared     tipos compartidos
tests          pruebas unitarias (vitest)
```

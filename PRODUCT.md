# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Sitio estático (HTML, CSS y módulos de JavaScript sin compilación) en `sitio/`, publicado en GitHub Pages con un
workflow de Actions. three.js 0.180 servido desde el propio sitio (sin CDN). Confirmado por el usuario. La aplicación
de escritorio (Electron + TypeScript) vive en `src/` y no forma parte del sitio.

## Users

- Personas que usan Windows y valoran instalar un asistente personal que no depende de servidores ni cuentas.
- El revisor de Google que evalúa la solicitud de OAuth: necesita encontrar y leer sin fricción la página principal,
  la Política de Privacidad y las Condiciones (inferido del encargo, no confirmado como audiencia única).

## Product Purpose

Orbe es un asistente de escritorio para Windows, de uso personal, hecho por un desarrollador independiente. Un conejo
3D vive en una esquina de la pantalla y abre un chat. El sitio explica qué es, qué hace con Gmail, cómo trata los
datos y dónde se descarga (https://github.com/Josias-glish/orbe).

## Positioning

Se instala en el ordenador del usuario: no tiene servidores propios ni cuentas, y el desarrollador no recibe ningún dato.

## Operating Context

- El conejo cambia de estado en la aplicación: reposo, leyendo, pensando, respondiendo, escuchando, actuando.
- Integración opcional con Gmail (la activa el usuario con el inicio de sesión de Google).

## Capabilities and Constraints

- Gmail: permisos `gmail.readonly` y `gmail.compose`. Busca y lee correos cuando el usuario lo pide y crea borradores
  que el usuario revisa y envía él mismo desde Gmail. No envía, no borra, no archiva, no modifica.
- El permiso de acceso se guarda cifrado en el ordenador (DPAPI de Windows).
- El texto de los correos que el usuario pide leer (solo texto, sin adjuntos, máximo 8000 caracteres) se envía al
  proveedor de IA configurado (por defecto, Claude de Anthropic), solo para responderle.
- Revocar: Orbe → Configuración → Conectores → Gmail, o https://myaccount.google.com/permissions.
- Software gratuito, tal cual, sin garantía.
- El sitio no lleva rastreadores, analítica ni peticiones a terceros.
- No se añaden funciones ni afirmaciones legales que no estén en esta lista.

## Brand Commitments

- Nombre: Orbe. Personaje: conejo negro con auriculares blancos, ojos de luz azul y sudadera con un orbe luminoso.
- Blanco, negro (#0a0a0b) y un acento rojo (#e0162b), decidido por el usuario; sin degradados de color en el fondo.
- Textos en español, tono directo.

## Evidence on Hand

- Modelo `resources/personaje/conejo.glb` y texturas de detalle `pelo.jpg` y `tejido.jpg`.
- No hay testimonios, cifras de uso ni capturas de la aplicación aprobadas para el sitio: no inventarlos.

## Product Principles

1. Decir solo lo que Orbe hace de verdad.
2. Las páginas legales cargan al instante y se leen sin JavaScript.
3. El personaje es la marca: debe sentirse vivo, nunca un adorno.
4. La privacidad se explica con precisión, no con eslóganes.

## Accessibility & Inclusion

Contraste AA, navegación por teclado, textos alternativos, `prefers-reduced-motion` respetado, legible sin WebGL ni JavaScript.

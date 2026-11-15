# Probar Orbe en un Mac (v1.24.3, en pruebas)

Guía para quien prueba Orbe en macOS. Orbe **no está firmado ni notarizado**: macOS avisará la primera vez y hay que
abrirlo a mano. Nada de esta prueba necesita contraseñas de nadie: si algún paso pide una clave, la escribe el dueño
de la cuenta en su propio equipo, nunca por chat.

## 1. Descargar

En https://github.com/Josias-glish/orbe/releases/tag/v1.24.3 descarga **una** de estas:

- Mac con Apple Silicon (M1, M2, M3, M4…): `Orbe-1.24.3-mac-arm64.dmg`
- Mac con Intel: `Orbe-1.24.3-mac-x64.dmg`

(Menú  → Acerca de este Mac → «Chip» dice Apple M… o «Procesador» dice Intel.) Hace falta macOS 12 o posterior.

## 2. Instalar y abrir la primera vez

1. Abre el `.dmg` y arrastra **Orbe** a **Aplicaciones**. Expulsa el disco.
2. Abre Orbe desde Aplicaciones. macOS dirá que no puede comprobar que no tenga software malicioso: pulsa **OK**
   (no «Trasladar a la papelera»).
3. Ve a **Ajustes del Sistema → Privacidad y seguridad**, baja hasta «Se bloqueó el uso de Orbe…» y pulsa
   **Abrir igualmente**; confirma con tu contraseña de usuario del Mac (https://support.apple.com/102445).
4. Orbe aparece como un **conejo** en una esquina y un icono en la **barra de menús** (arriba a la derecha). No sale en
   el Dock: es a propósito.

Si en el paso 2 dice «está dañado y no se puede abrir», abre Terminal y ejecuta
`xattr -dr com.apple.quarantine /Applications/Orbe.app` (quita la marca de descarga; no verificado que haga falta).

## 3. Permisos (Ajustes del Sistema → Privacidad y seguridad)

| Permiso | Para qué | Cuándo lo pide |
|---|---|---|
| **Accesibilidad** | Leer el texto de otras ventanas y el control del PC | La primera vez que Orbe lee la pantalla |
| **Grabación de pantalla** (o «Grabación de pantalla y audio del sistema») | Capturas, «pc_mirar», visión | La primera captura |
| **Micrófono** | Dictado | El primer dictado |

Después de activar Accesibilidad o Grabación de pantalla, **cierra Orbe** (barra de menús → Salir) y ábrelo otra vez.

## 4. Hablar con Claude

Orbe usa el **CLI de Claude** con la cuenta del usuario. En Terminal:

```
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Inicia sesión dentro de `claude` y sal (`/exit`). Orbe lo busca en `~/.local/bin`, `/opt/homebrew/bin` y
`/usr/local/bin`. (Instalador oficial: https://docs.claude.com/en/docs/claude-code/setup; no verificado hoy.)

La configuración va en `~/Library/Application Support/orbe/.env` (opcional; ver `.env.example` del repositorio).

## 5. Lista de prueba

Marca cada punto como ✅, ❌ (y qué pasó) o ⚠️ (raro). Si algo falla, una captura (⌘⇧4) y el texto exacto del error.

**Básico**
1. Doble clic en el centro del conejo → se abre el panel. ⌘⇧Espacio lo abre y lo cierra.
2. Escribe «hola» → responde Claude.
3. El icono de la barra de menús: mostrar/ocultar, «Abrir al iniciar sesión», Salir.
4. Los clics alrededor del conejo (zonas transparentes) llegan a la ventana de debajo.

**Pantalla**
5. Abre Safari o Chrome con una página, vuelve a Orbe y pulsa el **ojo** → chips «Ventana» y «Contenido» con el texto
   de la página. Prueba también en Notas.
6. Selecciona un texto en otra app y pulsa ⌘⇧⌥Espacio → aparece «Selección».
7. **Cámara** → captura de pantalla (pide Grabación de pantalla la primera vez).
8. **Texto de imagen** (botón [T]) → «Del portapapeles» tras copiar una imagen con texto: lo reconoce (Vision).
9. **Micrófono** → dicta una frase.

**Modo agente y control del PC** (con cuidado: Orbe moverá el ratón y escribirá)
10. «Abre la Calculadora» → la abre.
11. «Mira la ventana de Notas y escribe "prueba de Orbe" en una nota nueva» → borde naranja alrededor de la pantalla
    mientras actúa, luego escribe.
12. Mientras actúa, mueve el ratón o pulsa Esc → se detiene al momento.
13. «Abre Terminal» o «controla Ajustes del Sistema» → debe **negarse**.
14. Pide que copie y pegue un texto (Ctrl+C / Ctrl+V): en el Mac lo hace como ⌘C / ⌘V.
15. En una página con campo de contraseña, pídele que escriba ahí → debe **negarse**.

**Otros**
16. Ajustes (icono inferior) → Conectores: el texto del cofre menciona el Llavero de macOS. **No guardes claves reales.**
17. Tareas, Agentes y Memoria se abren sin errores.

## 6. Qué enviar de vuelta

- Modelo de Mac, chip (Apple/Intel) y versión de macOS.
- La lista con ✅/❌/⚠️ y las capturas.
- Si Orbe se cierra solo: el informe de fallo de **Consola → Informes de fallos** (busca «Orbe» u «orbe-helper»).

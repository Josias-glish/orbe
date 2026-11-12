import { BrowserWindow, screen, type Rectangle } from 'electron'
import type { MarcoPc, RectPc } from './control'

const HTML = (nombre: string): string => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:600 14px "Segoe UI",sans-serif}
#m{position:fixed;inset:0;border:4px solid #f5a623;box-sizing:border-box;display:none}
#a{position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#f5a623;color:#111;padding:6px 16px;border-radius:999px}
#s{position:fixed;border:3px solid #4fc3f7;border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,.28);display:none}
#t{position:absolute;top:100%;left:0;margin-top:8px;background:#4fc3f7;color:#111;padding:5px 12px;border-radius:8px;white-space:nowrap}
</style><div id="m"><div id="a">${nombre} está usando el PC · Esc para parar</div></div><div id="s"><div id="t"></div></div>
<script>
function marco(v){m.style.display=v?'block':'none'}
function senal(r){if(!r){s.style.display='none';return}Object.assign(s.style,{display:'block',left:r.x-6+'px',top:r.y-6+'px',width:r.w+12+'px',height:r.h+12+'px'});t.textContent=r.texto}
</script>`

/**
 * Una ventana transparente encima de todo, que no recibe clics ni el foco y no sale en las capturas: el borde de color
 * mientras Orbe actúa y el recuadro de «Muéstrame cómo». Cubre la pantalla de la ventana objetivo.
 */
export function crearMarco(nombre: string): MarcoPc {
  let v: BrowserWindow | null = null
  let listo: Promise<unknown> = Promise.resolve()
  let conMarco = false
  let conSenal: ReturnType<typeof setTimeout> | null = null

  const dip = (r: RectPc): Rectangle => screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.ancho, height: r.alto })

  const preparar = (r: RectPc | null | undefined): { ventana: BrowserWindow; zona: Rectangle } => {
    const zona = (r ? screen.getDisplayMatching(dip(r)) : screen.getPrimaryDisplay()).bounds
    if (!v || v.isDestroyed()) {
      v = new BrowserWindow({
        ...zona, show: false, frame: false, transparent: true, focusable: false, resizable: false, movable: false,
        skipTaskbar: true, hasShadow: false, alwaysOnTop: true, webPreferences: { sandbox: true, contextIsolation: true }
      })
      v.setIgnoreMouseEvents(true)
      v.setAlwaysOnTop(true, 'screen-saver')
      v.setContentProtection(true)
      listo = v.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML(nombre))}`).catch(() => undefined)
    }
    v.setBounds(zona)
    return { ventana: v, zona }
  }

  const ejecutar = (ventana: BrowserWindow, js: string): void => {
    void listo.then(() => (ventana.isDestroyed() ? undefined : ventana.webContents.executeJavaScript(js))).catch(() => undefined)
  }

  const quizasOcultar = (): void => {
    if (!conMarco && !conSenal && v && !v.isDestroyed()) v.hide()
  }

  return {
    mostrar(r) {
      const { ventana } = preparar(r)
      conMarco = true
      ejecutar(ventana, 'marco(true)')
      ventana.showInactive()
    },
    ocultar() {
      conMarco = false
      if (v && !v.isDestroyed()) ejecutar(v, 'marco(false)')
      quizasOcultar()
    },
    senalar(r, texto) {
      const { ventana, zona } = preparar(r)
      const d = dip(r)
      ejecutar(ventana, `senal(${JSON.stringify({ x: d.x - zona.x, y: d.y - zona.y, w: d.width, h: d.height, texto })})`)
      ventana.showInactive()
      if (conSenal) clearTimeout(conSenal)
      conSenal = setTimeout(() => {
        conSenal = null
        if (v && !v.isDestroyed()) ejecutar(v, 'senal(null)')
        quizasOcultar()
      }, 12_000)
    }
  }
}

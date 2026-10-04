import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VentanaOrbe } from './ventana'

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Prueba de humo (`npm run humo`): arranca con un proveedor de mentira, recorre los estados del
 * orbe y una conversación de ejemplo, guarda capturas del render en humo/ y sale.
 * Con `real` (`npm run humo:real`) conversa de verdad con Claude a través de la configuración del usuario.
 */
export async function ejecutarHumo(orbe: VentanaOrbe, real = false): Promise<void> {
  const carpeta = join(process.cwd(), 'humo')
  mkdirSync(carpeta, { recursive: true })
  const wc = orbe.ventana.webContents
  const informe: Record<string, unknown> = {}

  const js = <T = unknown>(codigo: string): Promise<T> => wc.executeJavaScript(codigo) as Promise<T>
  const capturar = async (nombre: string): Promise<void> => {
    const imagen = await wc.capturePage()
    writeFileSync(join(carpeta, `${nombre}.png`), imagen.toPNG())
  }
  /** Escribe en el campo de entrada y pulsa Enter, como haría una persona. */
  const escribirYEnviar = (texto: string): Promise<unknown> =>
    js(`(() => {
      const t = document.getElementById('entrada');
      t.value = ${JSON.stringify(texto)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })()`)
  const estadoOrbe = (): Promise<string> => js('window.__orbeDiagnostico().estado')
  const contar = (selector: string): Promise<number> => js(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  /** Espera a que termine la respuesta en curso (el botón vuelve a ser «Enviar»). */
  const esperarFin = async (maximoMs: number): Promise<boolean> => {
    const limite = Date.now() + maximoMs
    while (Date.now() < limite) {
      const enCurso = await js<boolean>(`document.getElementById('enviar').classList.contains('detener')`)
      if (!enCurso) return true
      await esperar(150)
    }
    return false
  }

  try {
    await new Promise<void>((r) => (wc.isLoading() ? wc.once('did-finish-load', () => r()) : r()))
    await esperar(1200)
    informe.webgl = await js('window.__orbeDiagnostico()')

    if (real) {
      // Conversación real: dos turnos para comprobar el streaming y la memoria.
      orbe.establecerExpandido(true)
      await esperar(700)
      informe.cabecera = await js(`document.getElementById('modelo')?.textContent`)
      await escribirYEnviar('Hola. Recuerda que mi número favorito es el 7. Preséntate en una frase.')
      await esperar(600)
      informe.orbeAlEnviar = await estadoOrbe()
      informe.terminoPrimero = await esperarFin(90_000)
      await esperar(700)
      await capturar('r-1-respuesta')
      await escribirYEnviar('¿Cuál era mi número favorito? Responde solo con el número.')
      informe.terminoSegundo = await esperarFin(90_000)
      await esperar(700)
      await capturar('r-2-memoria')
      informe.ultimaRespuesta = await js(`[...document.querySelectorAll('.msg.asistente .contenido')].at(-1)?.textContent`)
      informe.errores = await contar('.tarjeta-error')
      informe.burbujas = { usuario: await contar('.msg.usuario'), asistente: await contar('.msg.asistente') }
    } else {
      // 1. Estados del orbe
      for (const estado of ['reposo', 'leyendo', 'pensando', 'respondiendo']) {
        await js(`window.__orbeEstado(${JSON.stringify(estado)})`)
        await esperar(estado === 'leyendo' ? 500 : 900)
        await capturar(`1-${estado}`)
      }
      await js(`window.__orbeEstado('reposo')`)

      // 2. Panel expandido, vacío
      orbe.establecerExpandido(true)
      await esperar(700)
      await capturar('2-expandido')
      informe.boundsExpandido = orbe.ventana.getBounds()
      informe.cabecera = await js(`document.getElementById('modelo')?.textContent`)

      // 3. Conversación de ejemplo con streaming
      await escribirYEnviar('Hola, ¿qué puedes hacer por mí?')
      await esperar(350)
      informe.orbePensando = await estadoOrbe()
      await capturar('3-pensando')
      await esperar(1100)
      informe.orbeRespondiendo = await estadoOrbe()
      await capturar('3-streaming')
      await esperar(2600)
      informe.orbeFinal = await estadoOrbe()
      await capturar('3-respuesta')
      informe.burbujas = {
        usuario: await contar('.msg.usuario'),
        asistente: await contar('.msg.asistente'),
        bloquesCodigo: await contar('.msg.asistente pre code'),
        listas: await contar('.msg.asistente li'),
        enlaces: await contar('.msg.asistente a[href]')
      }

      // 4. Error
      await escribirYEnviar('/error simulado')
      await esperar(1500)
      await capturar('4-error')
      informe.tarjetasError = await contar('.tarjeta-error')
      informe.botonReintentar = await contar('.tarjeta-error button')

      // 5. Nueva conversación
      await js(`document.getElementById('nueva')?.click()`)
      await esperar(400)
      informe.mensajesTrasNueva = await contar('.msg')
      await capturar('5-nueva')

      orbe.establecerExpandido(false)
      await esperar(400)
      informe.boundsColapsado = orbe.ventana.getBounds()
      // En reposo estable el orbe debe quedarse en ~30 fps como máximo.
      await esperar(2600)
      informe.fpsReposo = await js('window.__orbeDiagnostico().fps')
    }
  } catch (error) {
    informe.error = String(error)
  }

  writeFileSync(join(carpeta, real ? 'informe-real.json' : 'informe.json'), JSON.stringify(informe, null, 2))
  console.log('HUMO', JSON.stringify(informe))
  BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  app.exit(informe.error ? 1 : 0)
}

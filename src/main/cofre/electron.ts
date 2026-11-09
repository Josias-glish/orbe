import { clipboard, ipcMain, safeStorage, shell, type BrowserWindow } from 'electron'
import { CANALES } from '../../shared/tipos'
import type { EstadoCofre, ResultadoCofre } from '../../shared/cofre'
import { Cofre, type Cifrador } from './cofre'
import { ControladorCofre } from './ipc'
import { conectarGmail, leerClienteGoogle, revocarEnGoogle } from '../conectores/gmail/oauth'

/** `safeStorage` de Electron: en Windows cifra con DPAPI, ligado a tu usuario de Windows. */
export const cifradorElectron: Cifrador = {
  disponible: () => safeStorage.isEncryptionAvailable(),
  cifrar: (texto) => safeStorage.encryptString(texto),
  descifrar: (datos) => safeStorage.decryptString(datos)
}

/**
 * Crea el cofre y abre sus canales (estado, guardar, borrar y conectar Gmail), solo para la ventana de Orbe.
 * `rutaClienteGoogle` es el `google-cliente.json` de la guía de Google.
 */
export function registrarCofre(ventana: BrowserWindow, ruta: string, rutaClienteGoogle: string): Cofre {
  const cofre = new Cofre(ruta, cifradorElectron)
  const control = new ControladorCofre(cofre, { leer: () => clipboard.readText(), vaciar: () => clipboard.clear() })
  const propia = (e: Electron.IpcMainInvokeEvent): boolean => e.sender === ventana.webContents
  ipcMain.handle(CANALES.cofreEstado, (e): EstadoCofre => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    return control.estado()
  })
  ipcMain.handle(CANALES.cofreGuardar, (e, clave: unknown, valor: unknown): Promise<ResultadoCofre> => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    return control.guardar(clave, valor)
  })
  ipcMain.handle(CANALES.cofreBorrar, (e, clave: unknown): ResultadoCofre => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    // Revocar Gmail: además de borrarlo aquí, se avisa a Google de que ese permiso ya no vale.
    if (clave === 'gmail.refresh') {
      try {
        const permiso = cofre.leer('gmail.refresh')
        if (typeof permiso === 'string') void revocarEnGoogle(permiso)
      } catch {
        // cofre ilegible: `borrar` lo dirá
      }
    }
    return control.borrar(clave)
  })
  let conectando = false
  ipcMain.handle(CANALES.gmailConectar, async (e): Promise<ResultadoCofre> => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    if (conectando) return { ok: false, error: 'Ya hay una conexión en curso: termina en el navegador.', estado: control.estado() }
    conectando = true
    try {
      // El permiso va de Google al cofre sin pasar por la interfaz.
      cofre.guardar('gmail.refresh', await conectarGmail(leerClienteGoogle(rutaClienteGoogle), { abrir: (url) => shell.openExternal(url) }))
      return { ok: true, estado: control.estado() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'No se pudo conectar Gmail.', estado: control.estado() }
    } finally {
      conectando = false
    }
  })
  return cofre
}

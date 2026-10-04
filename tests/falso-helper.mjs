// Lector de pantalla de mentira: habla el mismo protocolo (JSON por líneas) que helper/uia-helper.ps1.
// El modo se elige con el primer argumento:
//   normal           arranca bien y atiende las operaciones de abajo
//   ruido            igual, pero mezcla líneas que no son JSON entre las respuestas
//   error-arranque   dice {"tipo":"error"} y sale (como si no compilara el C#)
//   cae-al-arrancar  escribe en stderr y sale sin decir «listo»
//   no-arranca       no dice «listo» nunca
// Operaciones: eco (devuelve la petición; admite retrasoMs), falla, silencio (no responde), morir (sale de golpe).
import { createInterface } from 'node:readline'

const modo = process.argv[2] ?? 'normal'
const decir = (objeto) => process.stdout.write(`${JSON.stringify(objeto)}\n`)

if (modo === 'error-arranque') {
  decir({ tipo: 'error', mensaje: 'No se pudo preparar el lector de pantalla: no compila.' })
  process.exit(2)
}
if (modo === 'cae-al-arrancar') {
  process.stderr.write('Fallo grave al compilar\n')
  process.exit(1)
}
if (modo === 'no-arranca') {
  setInterval(() => {}, 1000)
} else {
  if (modo === 'ruido') process.stdout.write('esto no es JSON\n\n')
  decir({ tipo: 'listo' })

  const lector = createInterface({ input: process.stdin })
  lector.on('line', (linea) => {
    let peticion
    try {
      peticion = JSON.parse(linea)
    } catch {
      return
    }
    const { id, op } = peticion
    if (modo === 'ruido') process.stdout.write('PS C:\\> basura\n')
    switch (op) {
      case 'eco':
        setTimeout(() => decir({ id, ok: true, datos: peticion }), peticion.retrasoMs ?? 0)
        break
      case 'falla':
        decir({ id, ok: false, error: 'No se pudo leer esa ventana.' })
        break
      case 'morir':
        process.exit(3)
        break
      case 'silencio':
        break
      default:
        decir({ id, ok: false, error: `Operación desconocida: ${op}` })
    }
  })
  lector.on('close', () => process.exit(0))
}

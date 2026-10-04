// Prepara los fondos que se incluyen en el instalador: reduce cada imagen de una carpeta (lado mayor 1600 px, JPEG)
// y las deja en resources/fondos/. Uso: npm run fondos -- "C:\ruta\a\tus\imagenes"
// La carpeta resources/fondos/ está en .gitignore: son tus imágenes y no se suben al repositorio.
const { app, nativeImage } = require('electron')
const { mkdirSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { extname, join, basename } = require('node:path')

const LADO = 1600
const origen = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'))
const destino = join(__dirname, '..', 'resources', 'fondos')

app.whenReady().then(() => {
  if (!origen) {
    console.error('Uso: npm run fondos -- "C:\\ruta\\a\\tus\\imagenes"')
    app.exit(1)
    return
  }
  const nombres = readdirSync(origen)
    .filter((n) => ['.png', '.jpg', '.jpeg'].includes(extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
  rmSync(destino, { recursive: true, force: true })
  mkdirSync(destino, { recursive: true })
  let hechas = 0
  for (const nombre of nombres) {
    const imagen = nativeImage.createFromPath(join(origen, nombre))
    if (imagen.isEmpty()) {
      console.warn('No se pudo abrir:', nombre)
      continue
    }
    const { width, height } = imagen.getSize()
    const factor = Math.min(1, LADO / Math.max(width, height))
    const reducida =
      factor === 1 ? imagen : imagen.resize({ width: Math.round(width * factor), height: Math.round(height * factor), quality: 'best' })
    writeFileSync(join(destino, basename(nombre, extname(nombre)) + '.jpg'), reducida.toJPEG(80))
    hechas++
  }
  console.log(`${hechas} fondos preparados en ${destino}`)
  app.exit(0)
})

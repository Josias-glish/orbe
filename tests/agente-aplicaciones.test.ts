import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AccionVista } from '../src/shared/tipos'
import {
  CatalogoAplicaciones,
  leerAppsTienda,
  leerConfigApps,
  motivoDestinoProhibido,
  motivoNombreProhibido,
  normalizar,
  type ConfigApps,
  type DepsCatalogo
} from '../src/main/agente/aplicaciones'
import { EjecutorHerramientas } from '../src/main/agente/ejecutor'
import { crearAbrirAplicacion, type LanzadorApps } from '../src/main/agente/herramientas/abrir-aplicacion'
import { crearAbrirUrl } from '../src/main/agente/herramientas/abrir-url'
import { Politica } from '../src/main/agente/politica'
import { RegistroHerramientas } from '../src/main/agente/registro'
import { AccionProhibida, definirHerramienta } from '../src/main/agente/tipos'

// ---------------------------------------------------------------------------------------------
// Un menú Inicio de mentira
// ---------------------------------------------------------------------------------------------

const USUARIO = join('C:', 'Users', 'yo', 'Start Menu', 'Programs')
const COMUN = join('C:', 'ProgramData', 'Start Menu', 'Programs')

interface Montaje {
  /** Carpetas del menú Inicio: nombre de carpeta → hijos (los que acaban en «/» son carpetas). */
  carpetas?: Record<string, string[]>
  /** Destino de cada acceso directo, por ruta (null: no se puede leer). */
  atajos?: Record<string, { destino: string; argumentos?: string } | null>
  tienda?: Array<{ nombre: string; appId: string }>
  config?: ConfigApps
  archivos?: string[]
  tiendaFalla?: boolean
}

function montarDeps(m: Montaje) {
  const llamadas = { listar: 0, tienda: 0, config: 0 }
  const deps: DepsCatalogo = {
    carpetasInicio: [USUARIO, COMUN],
    listarDirectorio: async (carpeta) => {
      llamadas.listar++
      const hijos = (m.carpetas ?? {})[carpeta]
      if (!hijos) throw new Error('no existe')
      return hijos.map((h) => (h.endsWith('/') ? { nombre: h.slice(0, -1), esCarpeta: true } : { nombre: h, esCarpeta: false }))
    },
    leerAtajo: (ruta) => {
      const a = (m.atajos ?? {})[ruta]
      return a === undefined ? { destino: 'C:\\Program Files\\App\\app.exe', argumentos: '' } : a === null ? null : { destino: a.destino, argumentos: a.argumentos ?? '' }
    },
    listarAppsTienda: async () => {
      llamadas.tienda++
      if (m.tiendaFalla) throw new Error('PowerShell no está')
      return m.tienda ?? []
    },
    leerConfiguracion: async () => {
      llamadas.config++
      return m.config ?? { alias: {}, excluir: [] }
    },
    existeArchivo: async (ruta) => (m.archivos ?? []).includes(ruta)
  }
  return { deps, llamadas }
}

function catalogo(m: Montaje, reloj?: { t: number }) {
  const { deps, llamadas } = montarDeps(m)
  return { cat: new CatalogoAplicaciones(deps, reloj ? { ahora: () => reloj.t } : {}), llamadas, deps }
}

const MENU: Montaje = {
  carpetas: {
    [USUARIO]: ['Spotify.lnk', 'Visual Studio Code/', 'Desktop.ini'],
    [join(USUARIO, 'Visual Studio Code')]: ['Visual Studio Code.lnk'],
    [COMUN]: ['Google Chrome.lnk', 'Microsoft Word.lnk', 'Microsoft Excel.lnk', 'Microsoft Edge.lnk', 'Steam/', 'Spotify.lnk']
  },
  tienda: [
    { nombre: 'Calculadora', appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
    { nombre: 'Bloc de notas', appId: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App' }
  ]
}

const nombres = async (cat: CatalogoAplicaciones, texto: string): Promise<string> => {
  const r = await cat.resolver(texto)
  if (r.tipo === 'una') return r.entrada.nombre
  if (r.tipo === 'varias') return `varias: ${r.candidatas.join(' | ')}`
  if (r.tipo === 'prohibida') return `prohibida: ${r.motivo}`
  return `ninguna${r.sugerencias.length ? `: ${r.sugerencias.join(' | ')}` : ''}`
}

describe('normalizar', () => {
  it('quita tildes, mayúsculas y símbolos', () => {
    expect(normalizar('  Símbolo   del-Sistema! ')).toBe('simbolo del sistema')
    expect(normalizar('Configuración')).toBe('configuracion')
    expect(normalizar('Ñandú.exe')).toBe('nandu exe')
    expect(normalizar('日本語アプリ')).toBe('日本語アプリ')
    expect(normalizar('***')).toBe('')
  })
})

describe('CatalogoAplicaciones: lectura del menú Inicio', () => {
  it('encuentra accesos directos en subcarpetas y apps de la Store, ignora lo que no es .lnk y no repite nombres', async () => {
    const { cat } = catalogo(MENU)
    expect(await nombres(cat, 'Spotify')).toBe('Spotify')
    expect(await nombres(cat, 'Visual Studio Code')).toBe('Visual Studio Code')
    expect(await nombres(cat, 'Calculadora')).toBe('Calculadora')
    expect(await nombres(cat, 'Desktop')).toMatch(/^ninguna/)
    const spotify = await cat.resolver('spotify')
    // El de la carpeta del usuario, que se lee primero, gana al común.
    expect(spotify.tipo === 'una' && spotify.entrada.ruta).toBe(join(USUARIO, 'Spotify.lnk'))
  })

  it('descarta desinstaladores, ayudas, licencias y sitios web', async () => {
    const { cat } = catalogo({
      carpetas: { [COMUN]: ['Steam.lnk', 'Desinstalar Steam.lnk', 'Uninstall Foo.lnk', 'Léeme.lnk', 'Ayuda de Foo.lnk', 'Sitio web de Foo.lnk', 'Foo License.lnk', 'Foo.lnk'] }
    })
    expect(await nombres(cat, 'Steam')).toBe('Steam')
    expect(await nombres(cat, 'Foo')).toBe('Foo')
    for (const n of ['Desinstalar Steam', 'Uninstall Foo', 'Léeme', 'Ayuda de Foo', 'Sitio web de Foo', 'Foo License']) {
      expect(await nombres(cat, n)).toMatch(/^ninguna/)
    }
  })

  it('con el menú vacío, ilegible o sin PowerShell sigue funcionando con lo que haya', async () => {
    const vacio = catalogo({})
    expect(await nombres(vacio.cat, 'Spotify')).toBe('ninguna')
    const sinTienda = catalogo({ ...MENU, tiendaFalla: true })
    expect(await nombres(sinTienda.cat, 'Spotify')).toBe('Spotify')
    expect(await nombres(sinTienda.cat, 'Calculadora')).toMatch(/^ninguna/)
  })

  it('una app de la Store con un identificador raro no se usa nunca', async () => {
    const { cat } = catalogo({
      tienda: [
        { nombre: 'Buena', appId: 'Paquete.Buena_abc123!App' },
        { nombre: 'Rara', appId: 'Paquete!App & calc.exe' },
        { nombre: 'Otra', appId: 'Sin signo' },
        { nombre: 'Vacia', appId: '' }
      ]
    })
    expect(await nombres(cat, 'Buena')).toBe('Buena')
    for (const n of ['Rara', 'Otra', 'Vacia']) expect(await nombres(cat, n)).toMatch(/^ninguna/)
  })

  it('se lee una vez y se guarda; caduca con el tiempo; varias lecturas a la vez comparten una sola', async () => {
    const reloj = { t: 1_000_000 }
    const { cat, llamadas } = catalogo(MENU, reloj)
    await Promise.all([cat.resolver('Spotify'), cat.resolver('Chrome'), cat.resolver('Calculadora')])
    expect(llamadas.tienda).toBe(1)
    await cat.resolver('Word')
    expect(llamadas.tienda).toBe(1)
    reloj.t += 61 * 60_000
    await cat.resolver('Word')
    expect(llamadas.tienda).toBe(2)
  })

  it('una app recién instalada se encuentra: si no aparece, se vuelve a leer, pero no más de una vez cada 30 s', async () => {
    const reloj = { t: 1_000_000 }
    const montaje: Montaje = { carpetas: { [COMUN]: ['Spotify.lnk'] } }
    const { cat, llamadas } = catalogo(montaje, reloj)
    expect(await nombres(cat, 'Nueva')).toBe('ninguna')
    expect(llamadas.tienda).toBe(1) // acaba de leer: no repite

    montaje.carpetas = { [COMUN]: ['Spotify.lnk', 'Nueva.lnk'] }
    expect(await nombres(cat, 'Nueva')).toBe('ninguna') // seguía sin repetir
    reloj.t += 31_000
    expect(await nombres(cat, 'Nueva')).toBe('Nueva')
    expect(llamadas.tienda).toBe(2)
  })
})

describe('CatalogoAplicaciones: cómo se resuelve un nombre', () => {
  it('el nombre exacto gana, sin importar tildes ni mayúsculas', async () => {
    const { cat } = catalogo(MENU)
    expect(await nombres(cat, 'CALCULADORA')).toBe('Calculadora')
    expect(await nombres(cat, 'bloc de notas')).toBe('Bloc de notas')
    expect(await nombres(cat, 'Bloc   de   notas')).toBe('Bloc de notas')
  })

  it('un prefijo o un fragmento único bastan', async () => {
    const { cat } = catalogo(MENU)
    expect(await nombres(cat, 'chrome')).toBe('Google Chrome')
    expect(await nombres(cat, 'word')).toBe('Microsoft Word')
    expect(await nombres(cat, 'calc')).toBe('Calculadora')
  })

  it('si encajan varias, devuelve candidatas para que el usuario elija, no una al azar', async () => {
    const { cat } = catalogo(MENU)
    const r = await cat.resolver('microsoft')
    expect(r).toEqual({ tipo: 'varias', candidatas: ['Microsoft Word', 'Microsoft Excel', 'Microsoft Edge'] })
  })

  it('el prefijo gana al fragmento; sin coincidencias sugiere por palabras', async () => {
    const { cat } = catalogo({ carpetas: { [COMUN]: ['Code.lnk', 'Visual Studio Code.lnk', 'Visual Studio Installer.lnk'] } })
    // «code» es exacto aquí: abre Code, no la otra.
    expect(await nombres(cat, 'code')).toBe('Code')
    expect(await nombres(cat, 'visual')).toBe('varias: Visual Studio Code | Visual Studio Installer')
    expect(await nombres(cat, 'studio code editor')).toMatch(/^ninguna: /)
  })

  it('un Windows en inglés se entiende pidiendo la aplicación en español, y al revés', async () => {
    const ingles: Montaje = {
      carpetas: { [COMUN]: ['File Explorer.lnk', 'Desmos Calculadora Científica.lnk'] },
      atajos: { [join(COMUN, 'File Explorer.lnk')]: { destino: '' } },
      tienda: [
        { nombre: 'Calculator', appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
        { nombre: 'Notepad', appId: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App' },
        { nombre: 'Snipping Tool', appId: 'Microsoft.ScreenSketch_8wekyb3d8bbwe!App' }
      ]
    }
    const { cat } = catalogo(ingles)
    // «Calculadora» solo está dentro del nombre de una app ajena: se usa la de Windows, no esa.
    expect(await nombres(cat, 'Calculadora')).toBe('Calculator')
    expect(await nombres(cat, 'bloc de notas')).toBe('Notepad')
    expect(await nombres(cat, 'Herramienta de recortes')).toBe('Snipping Tool')
    expect(await nombres(cat, 'explorador de archivos')).toBe('File Explorer')

    // Y en un Windows en español, pidiéndola en inglés.
    const espanol = catalogo({ tienda: [{ nombre: 'Calculadora', appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }] })
    expect(await nombres(espanol.cat, 'Calculator')).toBe('Calculadora')
  })

  it('un alias del usuario manda sobre los sinónimos de fábrica', async () => {
    const { cat } = catalogo({
      carpetas: { [COMUN]: ['Mi Calculadora.lnk'] },
      tienda: [{ nombre: 'Calculator', appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }],
      config: { alias: { calculadora: 'Mi Calculadora' }, excluir: [] }
    })
    expect(await nombres(cat, 'calculadora')).toBe('Mi Calculadora')
  })

  it('el Explorador de archivos (un acceso directo sin programa de destino) se abre; los demás sin destino, no', async () => {
    const { cat } = catalogo({
      carpetas: { [COMUN]: ['File Explorer.lnk', 'Control Panel.lnk', 'Run.lnk'] },
      atajos: { [join(COMUN, 'File Explorer.lnk')]: { destino: '' }, [join(COMUN, 'Control Panel.lnk')]: { destino: '' }, [join(COMUN, 'Run.lnk')]: { destino: '' } }
    })
    expect(await nombres(cat, 'File Explorer')).toBe('File Explorer')
    expect((await cat.resolver('Run')).tipo).toBe('prohibida')
    expect((await cat.resolver('Control Panel')).tipo).toBe('prohibida')
  })

  it('las consolas de administración (.msc) se explican como herramientas de administración, no como scripts', async () => {
    expect(motivoDestinoProhibido('C:\\Windows\\System32\\taskschd.msc')).toMatch(/herramienta de administración/)
    expect(motivoDestinoProhibido('C:\\x\\limpiar.bat')).toMatch(/script o un instalador/)
  })

  it('los desinstaladores en otros idiomas no se ofrecen como aplicaciones', async () => {
    const { cat } = catalogo({ carpetas: { [COMUN]: ['卸载360 Extreme Browser.lnk', '360 Extreme Browser.lnk', 'アンインストール Foo.lnk', 'Désinstaller Bar.lnk'] } })
    expect(await nombres(cat, '360 Extreme Browser')).toBe('360 Extreme Browser')
    for (const n of ['卸载360 Extreme Browser', 'アンインストール Foo', 'Désinstaller Bar']) expect(await nombres(cat, n)).toMatch(/^ninguna/)
  })

  it('con menos de tres letras solo vale el nombre exacto', async () => {
    const { cat } = catalogo({ carpetas: { [COMUN]: ['Zoom.lnk', 'Word.lnk', 'R.lnk'] } })
    expect(await nombres(cat, 'zo')).toBe('ninguna')
    expect(await nombres(cat, 'R')).toBe('R')
    expect(await nombres(cat, '')).toBe('ninguna')
    expect(await nombres(cat, '   ')).toBe('ninguna')
  })
})

describe('CatalogoAplicaciones: lo que nunca se abre', () => {
  const PELIGROSAS: Montaje = {
    carpetas: {
      [COMUN]: [
        'Símbolo del sistema.lnk',
        'Mi consola.lnk',
        'Windows PowerShell.lnk',
        'Editor del Registro.lnk',
        'Limpiar.lnk',
        'Instalar.lnk',
        'Rara.lnk',
        'Ajustes raros.lnk',
        'Calculadora vieja.lnk',
        'Bloc.lnk'
      ]
    },
    atajos: {
      [join(COMUN, 'Símbolo del sistema.lnk')]: { destino: 'C:\\Windows\\System32\\cmd.exe' },
      [join(COMUN, 'Mi consola.lnk')]: { destino: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', argumentos: '-NoExit' },
      [join(COMUN, 'Windows PowerShell.lnk')]: { destino: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
      [join(COMUN, 'Editor del Registro.lnk')]: { destino: 'C:\\Windows\\regedit.exe' },
      [join(COMUN, 'Limpiar.lnk')]: { destino: 'C:\\Scripts\\limpiar.bat' },
      [join(COMUN, 'Instalar.lnk')]: { destino: 'C:\\Descargas\\instalador.msi' },
      [join(COMUN, 'Rara.lnk')]: null,
      [join(COMUN, 'Ajustes raros.lnk')]: { destino: 'C:\\Windows\\explorer.exe', argumentos: 'ms-settings:network' },
      [join(COMUN, 'Calculadora vieja.lnk')]: { destino: 'C:\\Windows\\System32\\calc.exe' },
      [join(COMUN, 'Bloc.lnk')]: { destino: '' }
    },
    tienda: [
      { nombre: 'Terminal', appId: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe!App' },
      { nombre: 'Configuración', appId: 'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel' },
      { nombre: 'PowerShell 7', appId: 'Microsoft.PowerShell_8wekyb3d8bbwe!App' },
      { nombre: 'Calculadora', appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }
    ]
  }

  it('los nombres de consolas y herramientas del sistema se niegan sin ni siquiera leer el menú Inicio', async () => {
    const { cat, llamadas } = catalogo(PELIGROSAS)
    for (const n of ['cmd', 'CMD.EXE', 'Command Prompt', 'símbolo del sistema', 'PowerShell', 'Windows PowerShell', 'pwsh', 'Terminal', 'Windows Terminal', 'regedit', 'Editor del Registro', 'Configuración', 'Settings', 'Panel de control', 'wsl', 'bash']) {
      const r = await cat.resolver(n)
      expect(r.tipo, n).toBe('prohibida')
    }
    expect(llamadas.listar).toBe(0)
    expect(llamadas.tienda).toBe(0)
  })

  it('un acceso directo cuyo destino es una consola, un script, un instalador o la configuración se niega aunque tenga otro nombre', async () => {
    const { cat } = catalogo(PELIGROSAS)
    for (const n of ['Mi consola', 'Limpiar', 'Instalar', 'Ajustes raros', 'Rara', 'Bloc', 'PowerShell 7']) {
      const r = await cat.resolver(n)
      expect(r.tipo, n).toBe('prohibida')
    }
  })

  it('lo prohibido no aparece como candidata ni como sugerencia ni se abre por un nombre parcial', async () => {
    const { cat } = catalogo(PELIGROSAS)
    expect(await nombres(cat, 'power')).toMatch(/^ninguna/)
    expect(await nombres(cat, 'consola')).toMatch(/prohibida/) // el nombre exacto sí se explica
    expect(await nombres(cat, 'registro')).toMatch(/^ninguna/)
    const r = await cat.resolver('calc')
    expect(r.tipo).toBe('varias')
    expect(JSON.stringify(r)).not.toMatch(/consola|PowerShell|Registro|Terminal|Instalar/)
  })

  it('lo normal de al lado sigue abriéndose', async () => {
    const { cat } = catalogo(PELIGROSAS)
    expect(await nombres(cat, 'Calculadora vieja')).toBe('Calculadora vieja')
    expect(await nombres(cat, 'Calculadora')).toBe('Calculadora')
  })

  it('motivoDestinoProhibido: programas, extensiones y argumentos', () => {
    for (const d of ['C:\\Windows\\System32\\cmd.exe', 'CMD.EXE', 'powershell', 'C:\\x\\pwsh.exe', 'wt.exe', 'mmc.exe', 'rundll32.exe', 'C:\\a\\b.bat', 'x.CMD', 'x.ps1', 'x.vbs', 'x.msi', 'x.msc', 'x.reg', 'x.hta', 'x.js', 'x.scr']) {
      expect(motivoDestinoProhibido(d), d).toBeTruthy()
    }
    expect(motivoDestinoProhibido('C:\\Windows\\explorer.exe', 'ms-settings:privacy')).toBeTruthy()
    expect(motivoDestinoProhibido('C:\\Windows\\explorer.exe', 'shell:::{26EE0668-A00A-44D7-9371-BEB064C98683}')).toBeUndefined()
    expect(motivoDestinoProhibido('C:\\Windows\\explorer.exe', 'C:\\Users\\yo')).toBeUndefined()
    expect(motivoDestinoProhibido('C:\\Juego\\juego.exe', '--remote-control')).toBeUndefined()
    expect(motivoDestinoProhibido('C:\\Program Files\\Spotify\\Spotify.exe')).toBeUndefined()
    expect(motivoDestinoProhibido('C:\\Windows\\System32\\calc.exe')).toBeUndefined()
    expect(motivoNombreProhibido('Spotify')).toBeUndefined()
  })
})

describe('CatalogoAplicaciones: aplicaciones.json', () => {
  it('un alias apunta a una aplicación de la lista', async () => {
    const { cat } = catalogo({ ...MENU, config: { alias: { calc: 'Calculadora', navegador: 'Google Chrome', mus: 'Spotify' }, excluir: [] } })
    expect(await nombres(cat, 'Navegador')).toBe('Google Chrome')
    expect(await nombres(cat, 'mus')).toBe('Spotify')
    // El nombre exacto de una app manda sobre un alias con ese mismo nombre.
    expect(await nombres(cat, 'calc')).toBe('Calculadora')
  })

  it('un alias a algo prohibido o que no existe no abre nada', async () => {
    const { cat } = catalogo({ ...MENU, config: { alias: { rapido: 'cmd', usos: 'PowerShell', fantasma: 'No Existe' }, excluir: [] } })
    expect((await cat.resolver('rapido')).tipo).toBe('prohibida')
    expect((await cat.resolver('usos')).tipo).toBe('prohibida')
    expect((await cat.resolver('fantasma')).tipo).toBe('ninguna')
  })

  it('un alias a una ruta local solo vale si existe, es .exe o .lnk y no es una consola', async () => {
    const exe = 'D:\\Juegos\\Mi Juego\\juego.exe'
    const lnk = 'D:\\Atajos\\Editor.lnk'
    const { cat } = catalogo({
      ...MENU,
      archivos: [exe, lnk, 'D:\\x\\cmd.exe', 'D:\\x\\leeme.txt', 'D:\\x\\tarea.bat', 'D:\\Atajos\\Consola.lnk'],
      atajos: { [lnk]: { destino: 'D:\\Editor\\editor.exe' }, 'D:\\Atajos\\Consola.lnk': { destino: 'C:\\Windows\\System32\\cmd.exe' } },
      config: {
        alias: {
          juego: exe,
          editor: lnk,
          ausente: 'D:\\no\\existe.exe',
          consola1: 'D:\\x\\cmd.exe',
          texto: 'D:\\x\\leeme.txt',
          script: 'D:\\x\\tarea.bat',
          consola2: 'D:\\Atajos\\Consola.lnk',
          remoto: '\\\\servidor\\compartida\\programa.exe',
          relativo: '..\\programa.exe'
        },
        excluir: []
      }
    })
    const juego = await cat.resolver('juego')
    expect(juego).toMatchObject({ tipo: 'una', entrada: { origen: 'ruta', ruta: exe, nombre: 'juego' } })
    expect(await cat.resolver('editor')).toMatchObject({ tipo: 'una', entrada: { origen: 'ruta', ruta: lnk } })
    expect((await cat.resolver('ausente')).tipo).toBe('ninguna')
    for (const n of ['consola1', 'texto', 'script', 'consola2']) expect((await cat.resolver(n)).tipo, n).toBe('prohibida')
    // Ni rutas de red (podrían ejecutar código de otro equipo) ni relativas.
    for (const n of ['remoto', 'relativo']) expect((await cat.resolver(n)).tipo, n).toBe('ninguna')
  })

  it('«excluir» esconde aplicaciones del menú', async () => {
    const { cat } = catalogo({ ...MENU, config: { alias: {}, excluir: ['spotify', 'Calculadora'] } })
    expect(await nombres(cat, 'Spotify')).toMatch(/^ninguna/)
    expect(await nombres(cat, 'Calculadora')).toMatch(/^ninguna/)
    expect(await nombres(cat, 'Chrome')).toBe('Google Chrome')
  })

  it('leerConfigApps descarta lo que no tiene la forma esperada y avisa', () => {
    expect(leerConfigApps('{"alias":{"calc":"Calculadora"},"excluir":["Foo"]}')).toEqual({
      config: { alias: { calc: 'Calculadora' }, excluir: ['Foo'] },
      avisos: []
    })
    expect(leerConfigApps('no es json').avisos[0]).toMatch(/no es un JSON válido/)
    expect(leerConfigApps('[1,2]').avisos[0]).toMatch(/debe ser un objeto/)
    const mixto = leerConfigApps(JSON.stringify({ alias: { bueno: 'Calculadora', malo: 5, vacio: '  ', largo: 'x'.repeat(300), '***': 'Calculadora' }, excluir: ['A', 7, ''] }))
    expect(mixto.config).toEqual({ alias: { bueno: 'Calculadora' }, excluir: ['A'] })
    expect(mixto.avisos).toHaveLength(4)
    expect(leerConfigApps('{"alias":[1],"excluir":"x"}').avisos).toHaveLength(2)
    expect(leerConfigApps('{}')).toEqual({ config: { alias: {}, excluir: [] }, avisos: [] })
  })

  it('leerAppsTienda entiende la salida de PowerShell con una app, con varias, vacía o con basura', () => {
    expect(leerAppsTienda('{"n":"Calculadora","i":"Paquete!App"}')).toEqual([{ nombre: 'Calculadora', appId: 'Paquete!App' }])
    expect(leerAppsTienda('[{"n":"A","i":"P!A"},{"n":"B","i":"Q!B"},{"n":3,"i":"x"},null]')).toEqual([
      { nombre: 'A', appId: 'P!A' },
      { nombre: 'B', appId: 'Q!B' }
    ])
    expect(leerAppsTienda('  ')).toEqual([])
    expect(() => leerAppsTienda('no json')).toThrow()
  })
})

// ---------------------------------------------------------------------------------------------
// Las herramientas, a través del ejecutor (con política y registro, como en la aplicación)
// ---------------------------------------------------------------------------------------------

function montarHerramientas(montaje: Montaje, opciones: { permitirLocal?: boolean; confirmar?: () => Promise<boolean> } = {}) {
  const { cat, llamadas } = catalogo(montaje)
  const abiertas: string[] = []
  const lanzadas: string[] = []
  const lanzador: LanzadorApps = {
    abrirRuta: async (ruta) => void lanzadas.push(`ruta:${ruta}`),
    abrirTienda: async (id) => void lanzadas.push(`tienda:${id}`)
  }
  const acciones: AccionVista[] = []
  const politica = new Politica()
  const ejecutor = new EjecutorHerramientas({
    registro: new RegistroHerramientas([crearAbrirUrl({ abrir: async (u) => void abiertas.push(u) }), crearAbrirAplicacion(cat, lanzador)]),
    politica,
    senal: new AbortController().signal,
    alAccion: (a) => acciones.push(a),
    confirmar: opciones.confirmar,
    nonce: 'NONCE',
    permitirLocal: opciones.permitirLocal ?? false
  })
  const usar = (nombre: string, entrada: unknown) => ejecutor.ejecutar({ id: 'x', nombre, entrada })
  return { usar, abiertas, lanzadas, acciones, llamadas, politica }
}

const estados = (a: AccionVista[]): string[] => a.map((x) => x.estado)

describe('abrir_url', () => {
  it('abre una página web y lo cuenta en el chat', async () => {
    const t = montarHerramientas({})
    const r = await t.usar('abrir_url', { url: 'https://es.wikipedia.org/wiki/Lima' })
    expect(r).toMatchObject({ esError: false })
    expect(r.contenido).toMatch(/No puedes ver la página/)
    expect(t.abiertas).toEqual(['https://es.wikipedia.org/wiki/Lima'])
    expect(t.acciones.map((a) => [a.estado, a.titulo])).toEqual([
      ['en_curso', 'Abriendo en el navegador: es.wikipedia.org/wiki/Lima'],
      ['ok', 'Abriendo en el navegador: es.wikipedia.org/wiki/Lima']
    ])
  })

  it('una dirección sin esquema se abre como https', async () => {
    const t = montarHerramientas({})
    await t.usar('abrir_url', { url: 'example.com/x' })
    expect(t.abiertas).toEqual(['https://example.com/x'])
  })

  it.each([
    'file:///C:/Windows/System32/cmd.exe',
    'javascript:alert(1)',
    'ms-settings:privacy',
    'http://localhost:3000/admin',
    'http://127.0.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'https://google.com@evil.example/'
  ])('«%s» queda prohibida: no se abre y el modelo recibe la orden de parar', async (url) => {
    const t = montarHerramientas({})
    const r = await t.usar('abrir_url', { url })
    expect(r.esError).toBe(true)
    expect(r.contenido).toMatch(/^PROHIBIDO: /)
    expect(r.contenido).toMatch(/pídele al usuario que lo haga él mismo/)
    expect(t.abiertas).toEqual([])
    expect(estados(t.acciones)).toEqual(['en_curso', 'denegada'])
  })

  it('con ORBE_PERMITIR_LOCAL abre las direcciones locales, pero nunca lo que no es web', async () => {
    const t = montarHerramientas({}, { permitirLocal: true })
    expect((await t.usar('abrir_url', { url: 'http://localhost:5173/' })).esError).toBe(false)
    expect((await t.usar('abrir_url', { url: 'file:///C:/x' })).esError).toBe(true)
    expect(t.abiertas).toEqual(['http://localhost:5173/'])
  })

  it('una dirección que no se entiende es un error corriente, no una prohibición', async () => {
    const t = montarHerramientas({})
    const r = await t.usar('abrir_url', { url: 'hola mundo' })
    expect(r.esError).toBe(true)
    expect(r.contenido).not.toMatch(/PROHIBIDO/)
    expect(r.contenido).toMatch(/dirección web válida/)
    expect(estados(t.acciones)).toEqual(['en_curso', 'error'])
  })

  it('no admite más parámetros que la dirección', async () => {
    const t = montarHerramientas({})
    const r = await t.usar('abrir_url', { url: 'https://example.com', nueva_ventana: true })
    expect(r.contenido).toMatch(/Parámetros que no existen/)
    expect(t.abiertas).toEqual([])
  })

  it('en modo vigilado (tras ver instrucciones sospechosas) pide permiso antes de abrir nada', async () => {
    let preguntas = 0
    const t = montarHerramientas({}, { confirmar: async () => (preguntas++, false) })
    t.politica.vigilar()
    const r = await t.usar('abrir_url', { url: 'https://example.com' })
    expect(preguntas).toBe(1)
    expect(r.esError).toBe(true)
    expect(t.abiertas).toEqual([])
    expect(estados(t.acciones)).toEqual(['en_curso', 'denegada'])
  })
})

describe('abrir_aplicacion', () => {
  it('abre un acceso directo del menú Inicio con la ruta del catálogo y sin argumentos', async () => {
    const t = montarHerramientas(MENU)
    const r = await t.usar('abrir_aplicacion', { nombre: 'Spotify' })
    expect(r).toMatchObject({ esError: false })
    expect(r.contenido).toMatch(/Pedí a Windows que abriera «Spotify»/)
    expect(t.lanzadas).toEqual([`ruta:${join(USUARIO, 'Spotify.lnk')}`])
    expect(t.acciones.map((a) => [a.estado, a.titulo])).toEqual([
      ['en_curso', 'Abriendo: Spotify'],
      ['ok', 'Abriendo: Spotify']
    ])
  })

  it('abre una app de la Store por su identificador', async () => {
    const t = montarHerramientas(MENU)
    await t.usar('abrir_aplicacion', { nombre: 'calculadora' })
    expect(t.lanzadas).toEqual(['tienda:Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'])
  })

  it('«abre cmd»: prohibido, sin leer el menú Inicio ni lanzar nada, y el modelo recibe la orden de parar', async () => {
    const t = montarHerramientas(MENU)
    for (const nombre of ['cmd', 'PowerShell', 'Terminal', 'Configuración', 'regedit']) {
      const r = await t.usar('abrir_aplicacion', { nombre })
      expect(r.esError, nombre).toBe(true)
      expect(r.contenido, nombre).toMatch(/^PROHIBIDO: /)
      expect(r.contenido, nombre).toMatch(/pídele al usuario que lo haga él mismo/)
    }
    expect(t.lanzadas).toEqual([])
    expect(t.llamadas.listar).toBe(0)
    expect(estados(t.acciones).filter((e) => e !== 'en_curso')).toEqual(Array(5).fill('denegada'))
  })

  it('un acceso directo que esconde una consola también se niega', async () => {
    const t = montarHerramientas({
      carpetas: { [COMUN]: ['Mi herramienta.lnk'] },
      atajos: { [join(COMUN, 'Mi herramienta.lnk')]: { destino: 'C:\\Windows\\System32\\cmd.exe', argumentos: '/k algo' } }
    })
    const r = await t.usar('abrir_aplicacion', { nombre: 'Mi herramienta' })
    expect(r.contenido).toMatch(/^PROHIBIDO: /)
    expect(t.lanzadas).toEqual([])
  })

  it('si encajan varias, no abre ninguna y le dice al modelo que pregunte', async () => {
    const t = montarHerramientas(MENU)
    const r = await t.usar('abrir_aplicacion', { nombre: 'microsoft' })
    expect(r.esError).toBe(true)
    expect(r.contenido).toMatch(/Hay varias aplicaciones que encajan con «microsoft»: Microsoft Word, Microsoft Excel, Microsoft Edge\. Pregúntale al usuario/)
    expect(t.lanzadas).toEqual([])
    expect(estados(t.acciones)).toEqual(['en_curso', 'error'])
  })

  it('si no existe, lo dice con sugerencias y sin abrir nada', async () => {
    const t = montarHerramientas(MENU)
    const r = await t.usar('abrir_aplicacion', { nombre: 'Microsoft Photoshop' })
    expect(r.esError).toBe(true)
    expect(r.contenido).toMatch(/No encuentro ninguna aplicación llamada «Microsoft Photoshop»/)
    expect(r.contenido).toMatch(/Parecidas: Microsoft Word/)
    expect(t.lanzadas).toEqual([])
    const sin = await montarHerramientas(MENU).usar('abrir_aplicacion', { nombre: 'Zzzzzz' })
    expect(sin.contenido).toMatch(/Si no está instalada, díselo al usuario/)
  })

  it.each(['C:\\Windows\\System32\\cmd.exe', '..\\x', 'calc.exe /c dir', 'a/b', 'a|b', 'x:y', 'dos\nlineas', '"quoted"', 'a*b', '<b>'])(
    'rechaza «%s»: solo un nombre, nunca una ruta ni una orden',
    async (nombre) => {
      const t = montarHerramientas(MENU)
      const r = await t.usar('abrir_aplicacion', { nombre })
      expect(r.esError).toBe(true)
      expect(t.lanzadas).toEqual([])
      expect(t.llamadas.listar).toBe(0)
    }
  )

  it('no admite argumentos ni más campos que el nombre', async () => {
    const t = montarHerramientas(MENU)
    const r = await t.usar('abrir_aplicacion', { nombre: 'Spotify', argumentos: '--algo' })
    expect(r.contenido).toMatch(/Parámetros que no existen: argumentos/)
    expect(t.lanzadas).toEqual([])
  })

  it('un alias del usuario a una ruta se abre con esa ruta', async () => {
    const exe = 'D:\\Juegos\\juego.exe'
    const t = montarHerramientas({ ...MENU, archivos: [exe], config: { alias: { juego: exe }, excluir: [] } })
    await t.usar('abrir_aplicacion', { nombre: 'juego' })
    expect(t.lanzadas).toEqual([`ruta:${exe}`])
  })

  it('si Windows no consigue abrirla, es un error y no un éxito', async () => {
    const { cat } = catalogo(MENU)
    const ejecutor = new EjecutorHerramientas({
      registro: new RegistroHerramientas([
        crearAbrirAplicacion(cat, {
          abrirRuta: async () => Promise.reject(new Error('Windows no pudo abrirla: ruta no encontrada')),
          abrirTienda: async () => {}
        })
      ]),
      politica: new Politica(),
      senal: new AbortController().signal,
      alAccion: () => {},
      nonce: 'N',
      permitirLocal: false
    })
    const r = await ejecutor.ejecutar({ id: 'x', nombre: 'abrir_aplicacion', entrada: { nombre: 'Spotify' } })
    expect(r).toMatchObject({ esError: true, contenido: 'Error: Windows no pudo abrirla: ruta no encontrada' })
  })
})

describe('el ejecutor y AccionProhibida', () => {
  it('lo que una herramienta descubre prohibido sale como «no permitida» y con la orden de parar', async () => {
    const herramienta = definirHerramienta<Record<string, never>>({
      nombre: 'tentadora',
      descripcion: 'x',
      esquema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      nivel: 'libre',
      validar: () => ({ ok: true, valor: {} }),
      describir: () => 'Haciendo algo',
      ejecutar: async () => {
        throw new AccionProhibida('Eso es la configuración del sistema.')
      }
    })
    const acciones: AccionVista[] = []
    const ejecutor = new EjecutorHerramientas({
      registro: new RegistroHerramientas([herramienta]),
      politica: new Politica(),
      senal: new AbortController().signal,
      alAccion: (a) => acciones.push(a),
      nonce: 'N',
      permitirLocal: false
    })
    const r = await ejecutor.ejecutar({ id: 'x', nombre: 'tentadora', entrada: {} })
    expect(r.esError).toBe(true)
    expect(r.contenido).toBe('PROHIBIDO: Eso es la configuración del sistema. No lo intentes de otra manera: detén la tarea y pídele al usuario que lo haga él mismo.')
    expect(acciones.map((a) => a.estado)).toEqual(['en_curso', 'denegada'])
    expect(acciones[1].resultado).toBe('Eso es la configuración del sistema.')
  })
})

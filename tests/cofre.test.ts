import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Cofre, TACHADO, type Cifrador } from '../src/main/cofre/cofre'
import { ControladorCofre, validarValorSecreto } from '../src/main/cofre/ipc'
import { BusActividad } from '../src/main/conectores/actividad'
import { SECRETOS } from '../src/shared/cofre'

/** Cifrador de mentira: invierte los bits (lo justo para que nada quede en claro en el archivo). */
function cifradorFalso(disponible = true): Cifrador {
  return {
    disponible: () => disponible,
    cifrar: (t) => Buffer.from(Buffer.from(t, 'utf8').map((b) => b ^ 0xff)),
    descifrar: (d) => Buffer.from(d.map((b) => b ^ 0xff)).toString('utf8')
  }
}

let carpeta: string
let ruta: string
beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), 'orbe-cofre-'))
  ruta = join(carpeta, 'cofre.bin')
})
afterEach(() => rmSync(carpeta, { recursive: true, force: true }))

describe('Cofre', () => {
  it('cifra al guardar y descifra al leer, también desde otra instancia', () => {
    const cofre = new Cofre(ruta, cifradorFalso())
    cofre.guardar('supabase.secret', 'sb_secret_abcdefghijklmnop')
    const bruto = readFileSync(ruta)
    expect(bruto.includes(Buffer.from('sb_secret_abcdefghijklmnop'))).toBe(false)
    expect(bruto.includes(Buffer.from('supabase.secret'))).toBe(false)
    expect(new Cofre(ruta, cifradorFalso()).leer('supabase.secret')).toBe('sb_secret_abcdefghijklmnop')
  })

  it('estado() solo dice qué hay, nunca el valor', () => {
    const cofre = new Cofre(ruta, cifradorFalso())
    cofre.guardar('ig.morfy', { token: 'IGQVJtokenlargo123', renovado: '2026-11-09T00:00:00.000Z' })
    const estado = cofre.estado()
    expect(estado).toEqual({ 'ig.morfy': true })
    expect(JSON.stringify(estado)).not.toContain('IGQVJ')
  })

  it('borrar quita la clave y deja las demás', () => {
    const cofre = new Cofre(ruta, cifradorFalso())
    cofre.guardar('a.uno', 'valor-uno-largo')
    cofre.guardar('a.dos', 'valor-dos-largo')
    cofre.borrar('a.uno')
    expect(new Cofre(ruta, cifradorFalso()).estado()).toEqual({ 'a.dos': true })
  })

  it('sin cifrado disponible no guarda nada en claro', () => {
    const cofre = new Cofre(ruta, cifradorFalso(false))
    expect(() => cofre.guardar('x.y', 'secreto-largo')).toThrow(/cifrado/)
    expect(existsSync(ruta)).toBe(false)
  })

  it('si cofre.bin no se puede abrir, no lo sobrescribe', () => {
    writeFileSync(ruta, Buffer.from('basura que no es un cofre'))
    const antes = readFileSync(ruta)
    const cofre = new Cofre(ruta, cifradorFalso())
    expect(() => cofre.guardar('x.y', 'secreto-largo')).toThrow(/No lo he tocado/)
    expect(readFileSync(ruta).equals(antes)).toBe(true)
  })

  it('tachar() sustituye los secretos guardados, pero no la fecha de renovación', () => {
    const cofre = new Cofre(ruta, cifradorFalso())
    cofre.guardar('ig.morfy', { token: 'IGQVJtokenlargo123', renovado: '2026-11-09T00:00:00.000Z' })
    cofre.guardar('supabase.secret', 'sb_secret_abcdefghijklmnop')
    const texto = 'Error con IGQVJtokenlargo123 y sb_secret_abcdefghijklmnop el 2026-11-09T00:00:00.000Z'
    expect(cofre.tachar(texto)).toBe(`Error con ${TACHADO} y ${TACHADO} el 2026-11-09T00:00:00.000Z`)
  })
})

describe('ControladorCofre (lo que hay detrás de los canales)', () => {
  it('solo acepta claves de la lista y guarda los tokens de Instagram con fecha', async () => {
    const cofre = new Cofre(ruta, cifradorFalso())
    const control = new ControladorCofre(cofre, undefined, () => new Date('2026-11-09T12:00:00Z'))
    expect((await control.guardar('inventada.clave', 'loquesea123')).ok).toBe(false)
    expect((await control.guardar('gmail.refresh', 'loquesea123')).ok).toBe(false) // lo guarda solo el conector de Gmail
    const r = await control.guardar('ig.jsdesign', '  IGQVJtokenlargo123  ')
    expect(r.ok).toBe(true)
    expect(cofre.leer('ig.jsdesign')).toEqual({ token: 'IGQVJtokenlargo123', renovado: '2026-11-09T12:00:00.000Z' })
    expect(JSON.stringify(r)).not.toContain('IGQVJ')
  })

  it('vacía el portapapeles solo si contiene el secreto guardado', async () => {
    let portapapeles = 'sb_secret_abcdefghijklmnop'
    const control = new ControladorCofre(new Cofre(ruta, cifradorFalso()), { leer: () => portapapeles, vaciar: () => (portapapeles = '') })
    await control.guardar('supabase.secret', 'sb_secret_abcdefghijklmnop')
    expect(portapapeles).toBe('')
    portapapeles = 'otra cosa'
    await control.guardar('supabase.secret', 'sb_secret_otroValor12345')
    expect(portapapeles).toBe('otra cosa')
  })

  it('con el cofre dañado, informa sin lanzar', () => {
    writeFileSync(ruta, Buffer.from('basura'))
    const estado = new ControladorCofre(new Cofre(ruta, cifradorFalso())).estado()
    expect(estado.disponible).toBe(false)
    expect(estado.error).toMatch(/cofre/)
  })

  it('todas las claves de la lista son únicas', () => {
    expect(new Set(SECRETOS.map((s) => s.clave)).size).toBe(SECRETOS.length)
  })
})

describe('validarValorSecreto', () => {
  it.each([
    ['', false],
    ['   ', false],
    ['con espacio dentro', false],
    ['linea1\nlinea2', false],
    ['x'.repeat(9000), false],
    [42, false],
    ['  sb_secret_ok123  ', true]
  ])('%j → %s', (valor, ok) => {
    expect(validarValorSecreto(valor).ok).toBe(ok)
  })
})

describe('Actividad sin secretos', () => {
  it('el bus tacha los secretos del cofre antes de guardar o avisar', () => {
    const cofre = new Cofre(ruta, cifradorFalso())
    cofre.guardar('supabase.secret', 'sb_secret_abcdefghijklmnop')
    const bus = new BusActividad()
    bus.filtrarCon((t) => cofre.tachar(t))
    const vistos: string[] = []
    bus.suscribir((e) => vistos.push(`${e.titulo} | ${e.detalle}`))
    bus.publicar({ id: '1', origen: 'prueba', tipo: 'error', titulo: 'Falló sb_secret_abcdefghijklmnop', detalle: 'clave sb_secret_abcdefghijklmnop', cuando: 0 })
    expect(vistos[0]).toBe(`Falló ${TACHADO} | clave ${TACHADO}`)
    expect(JSON.stringify(bus.ultimos())).not.toContain('sb_secret_abc')
  })
})

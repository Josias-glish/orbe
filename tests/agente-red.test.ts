import { describe, expect, it } from 'vitest'
import { analizarUrlWeb, esHostLocal } from '../src/main/agente/red'

const cerrado = { permitirLocal: false }
const abierto = { permitirLocal: true }

const ok = (texto: string, opciones = cerrado): string => {
  const r = analizarUrlWeb(texto, opciones)
  if (!r.ok) throw new Error(`«${texto}» debería valer: ${r.motivo}`)
  return r.url.href
}
const fallo = (texto: string, opciones = cerrado) => {
  const r = analizarUrlWeb(texto, opciones)
  if (r.ok) throw new Error(`«${texto}» no debería valer (${r.url.href})`)
  return r
}

describe('analizarUrlWeb: lo que sí se abre', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['http://example.com/a?b=1#c', 'http://example.com/a?b=1#c'],
    ['  https://es.wikipedia.org/wiki/Lima  ', 'https://es.wikipedia.org/wiki/Lima'],
    ['HTTPS://EJEMPLO.ORG/Ruta', 'https://ejemplo.org/Ruta'],
    ['https://8.8.8.8/', 'https://8.8.8.8/'],
    ['https://[2606:4700:4700::1111]/', 'https://[2606:4700:4700::1111]/'],
    ['https://ejemplo.org:8443/x', 'https://ejemplo.org:8443/x']
  ])('«%s»', (entrada, esperado) => {
    expect(ok(entrada)).toBe(esperado)
  })

  it('una dirección sin esquema se toma como https', () => {
    expect(ok('example.com')).toBe('https://example.com/')
    expect(ok('www.ejemplo.org/lima?x=1')).toBe('https://www.ejemplo.org/lima?x=1')
    expect(ok('ejemplo.org:8443/x')).toBe('https://ejemplo.org:8443/x')
  })
})

describe('analizarUrlWeb: lo que no se entiende (el modelo puede corregirlo)', () => {
  it.each(['', '   ', 'hola', 'no es una dirección', 'https://', `https://${'a'.repeat(3000)}.com`])('«%s»', (entrada) => {
    expect(fallo(entrada).tipo).toBe('invalida')
  })
})

describe('analizarUrlWeb: lo que no es una página web (prohibido)', () => {
  it.each([
    'file:///C:/Windows/System32/cmd.exe',
    'FILE:///etc/passwd',
    'javascript:alert(1)',
    'JavaScript:alert(document.domain)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'ms-settings:privacy',
    'ms-msdt:/id PCWDiagnostic',
    'mailto:alguien@example.com',
    'ftp://example.com/archivo',
    'chrome://settings',
    'about:blank',
    'steam://run/730',
    'localhost:3000',
    'blob:https://example.com/1234'
  ])('«%s»', (entrada) => {
    const r = fallo(entrada)
    expect(r.tipo).toBe('prohibida')
    expect(r.motivo).toMatch(/Solo abro direcciones web/)
  })

  it('con usuario y contraseña delante (el truco de las páginas falsas)', () => {
    for (const entrada of ['https://google.com@evil.example/', 'https://usuario:clave@ejemplo.org/', 'http://a:b@ejemplo.org']) {
      const r = fallo(entrada)
      expect(r.tipo).toBe('prohibida')
      expect(r.motivo).toMatch(/usuario y contraseña/)
    }
  })

  it('el permiso de red local no salva a lo que no es web ni a las credenciales', () => {
    expect(fallo('file:///C:/x', abierto).tipo).toBe('prohibida')
    expect(fallo('https://u:p@localhost/', abierto).tipo).toBe('prohibida')
  })
})

describe('esHostLocal y analizarUrlWeb con direcciones locales', () => {
  const locales = [
    'http://localhost',
    'http://localhost:8080/admin',
    'http://LOCALHOST./',
    'http://sub.localhost/',
    'http://127.0.0.1',
    'http://127.1/',
    'http://0x7f.0.0.1/',
    'http://0177.0.0.1/',
    'http://2130706433/',
    'http://0.0.0.0/',
    'http://10.0.0.5/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/', // metadatos de nube
    'http://100.64.0.1/',
    'http://224.0.0.1/',
    'http://[::1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:192.168.0.1]/',
    'http://[fe80::1]/',
    'http://[fd12:3456:789a::1]/',
    'http://[fc00::1]/',
    'http://[ff02::1]/',
    'http://[2002:7f00:1::1]/', // 6to4 con 127.0.0.1 dentro
    'http://[64:ff9b::7f00:1]/', // NAT64 con 127.0.0.1 dentro
    'http://intranet/',
    'http://router/',
    'http://impresora.local/',
    'http://nas.lan/',
    'http://servidor.internal/',
    'http://wiki.corp/',
    'http://casa.home.arpa/'
  ]
  it.each(locales)('%s se bloquea', (entrada) => {
    const r = fallo(entrada)
    expect(r.tipo).toBe('prohibida')
    expect(r.motivo).toMatch(/este equipo o a la red local/)
  })

  it.each(locales)('%s se abre con ORBE_PERMITIR_LOCAL', (entrada) => {
    expect(analizarUrlWeb(entrada, abierto).ok).toBe(true)
  })

  it.each([
    'http://172.15.0.1/',
    'http://172.32.0.1/',
    'http://100.63.255.255/',
    'http://100.128.0.1/',
    'http://192.169.0.1/',
    'http://11.0.0.1/',
    'http://8.8.8.8/',
    'http://localhost.ejemplo.org/',
    'http://milocal.com/',
    'http://notlocalhost.com/',
    'https://[2606:4700:4700::1111]/',
    'https://[2001:4860:4860::8888]/'
  ])('%s es una dirección pública y se abre', (entrada) => {
    expect(ok(entrada)).toMatch(/^https?:\/\//)
  })

  it('esHostLocal entiende nombres y direcciones sueltas', () => {
    expect(esHostLocal('localhost')).toBe(true)
    expect(esHostLocal('[::1]')).toBe(true)
    expect(esHostLocal('10.1.2.3')).toBe(true)
    expect(esHostLocal('ejemplo.org')).toBe(false)
    expect(esHostLocal('')).toBe(true)
  })

  it('una IPv6 que no se entiende cuenta como local: ante la duda, no se abre', () => {
    expect(esHostLocal('[1:2:3]')).toBe(true)
    expect(esHostLocal('[gggg::1]')).toBe(true)
  })
})

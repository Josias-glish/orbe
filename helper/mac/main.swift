// Ayudante de Orbe para macOS: lo que en Windows hacen uia-helper.ps1 + UiaHelper.cs (UI Automation, ratón y teclado)
// y ocr.ps1 (Windows.Media.Ocr). Lo lanza Orbe; no está pensado para usarse a mano. Se compila con
// scripts/compilar-helper-mac.sh (binario universal).
//
//   orbe-helper servidor --pid <pid de Orbe>   JSON por líneas, el mismo protocolo que el helper de Windows:
//       escribe {"tipo":"listo"} y responde a {"id":1,"op":…}. Operaciones: ventana, seleccion, contenido (lector de
//       pantalla) y elementos, actuar, ventanas, enfocar, punto, clic, teclas, texto, vigilar (control del PC).
//       Mientras vigila, avisa {"tipo":"usuario","que":"raton"|"teclado"|"esc"} si el usuario toca el ratón o el teclado.
//   orbe-helper ocr <ruta de imagen>           una línea: {"ok":true,"texto":"…","idioma":"es-ES"} o {"ok":false,"error":"…"}
//
// No envía nada a internet ni guarda nada. Lee y controla con la API de Accesibilidad (necesita ese permiso para Orbe)
// y reconoce texto con Vision, en el propio Mac. El «hwnd» del protocolo es aquí el número de ventana del sistema
// (CGWindowID), el mismo que usa Electron en `desktopCapturer` («window:<número>:0»). Las coordenadas van en puntos
// de pantalla, con el origen arriba a la izquierda de la pantalla principal (las mismas unidades que Electron en macOS).

import AppKit
import ApplicationServices
import Foundation
import Vision

// MARK: - Salida

func escribir(_ objeto: [String: Any]) {
  guard let datos = try? JSONSerialization.data(withJSONObject: objeto, options: []),
        var linea = String(data: datos, encoding: .utf8) else { return }
  linea += "\n"
  FileHandle.standardOutput.write(linea.data(using: .utf8)!)
}

struct FalloHelper: Error {
  let mensaje: String
}

let PERMISO_ACCESIBILIDAD =
  "Orbe necesita el permiso de Accesibilidad para leer y controlar otras ventanas: Ajustes del Sistema → Privacidad y seguridad → Accesibilidad → activa Orbe (si ya estaba, desactívalo y vuelve a activarlo tras actualizar Orbe)."

// MARK: - OCR (Vision)

func reconocer(_ ruta: String) -> Int32 {
  let url = URL(fileURLWithPath: ruta)
  guard let fuente = CGImageSourceCreateWithURL(url as CFURL, nil),
        let imagen = CGImageSourceCreateImageAtIndex(fuente, 0, nil) else {
    escribir(["ok": false, "error": "No puedo abrir la imagen."])
    return 2
  }
  let peticion = VNRecognizeTextRequest()
  peticion.recognitionLevel = .accurate
  peticion.usesLanguageCorrection = true
  // Español primero y luego inglés, si esta versión de macOS los reconoce.
  let deseados = ["es-ES", "en-US"]
  peticion.recognitionLanguages = deseados
  if #available(macOS 12, *), let soportados = try? peticion.supportedRecognitionLanguages() {
    let elegidos = deseados.filter { soportados.contains($0) }
    if !elegidos.isEmpty { peticion.recognitionLanguages = elegidos }
  }
  do {
    try VNImageRequestHandler(cgImage: imagen, options: [:]).perform([peticion])
  } catch {
    escribir(["ok": false, "error": "macOS no ha podido leer la imagen: \(error.localizedDescription)"])
    return 2
  }
  let lineas = (peticion.results ?? []).compactMap { $0.topCandidates(1).first?.string }
  escribir(["ok": true, "texto": lineas.joined(separator: "\n"), "idioma": peticion.recognitionLanguages.first ?? "es-ES"])
  return 0
}

// MARK: - Accesibilidad: lectura de atributos

/** Número de ventana del sistema de un elemento ventana de Accesibilidad. API privada, pero estable desde hace años
 *  (la usan Hammerspoon, Rectangle o yabai): sin ella no hay forma fiable de unir las dos (no verificado en macOS 26). */
@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ elemento: AXUIElement, _ numero: UnsafeMutablePointer<CGWindowID>) -> AXError

let SISTEMA = AXUIElementCreateSystemWide()

/** Navegadores: de ellos se intenta sacar la dirección de la página. */
let NAVEGADORES: Set<String> = [
  "com.apple.Safari", "com.apple.SafariTechnologyPreview", "com.google.Chrome", "com.google.Chrome.canary",
  "com.microsoft.edgemac", "org.mozilla.firefox", "com.brave.Browser", "company.thebrowser.Browser",
  "com.operasoftware.Opera", "com.vivaldi.Vivaldi", "org.chromium.Chromium"
]

/** Chromium solo construye su árbol de accesibilidad si un lector lo pide (no verificado en todas las versiones). */
let CHROMIUM: Set<String> = [
  "com.google.Chrome", "com.google.Chrome.canary", "com.microsoft.edgemac", "com.brave.Browser",
  "company.thebrowser.Browser", "com.operasoftware.Opera", "com.vivaldi.Vivaldi", "org.chromium.Chromium"
]

func valor(_ e: AXUIElement, _ nombre: String) -> CFTypeRef? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(e, nombre as CFString, &v) == .success else { return nil }
  return v
}

func texto(_ e: AXUIElement, _ nombre: String) -> String? {
  guard let v = valor(e, nombre) else { return nil }
  if CFGetTypeID(v) == CFStringGetTypeID() { return (v as! CFString) as String }
  if CFGetTypeID(v) == CFURLGetTypeID() { return ((v as! CFURL) as URL).absoluteString }
  return nil
}

func numero(_ e: AXUIElement, _ nombre: String) -> Int? {
  guard let v = valor(e, nombre), CFGetTypeID(v) == CFNumberGetTypeID() else { return nil }
  return (v as! NSNumber).intValue
}

func logico(_ e: AXUIElement, _ nombre: String) -> Bool? {
  guard let v = valor(e, nombre) else { return nil }
  if CFGetTypeID(v) == CFBooleanGetTypeID() { return CFBooleanGetValue((v as! CFBoolean)) }
  if CFGetTypeID(v) == CFNumberGetTypeID() { return (v as! NSNumber).intValue != 0 }
  return nil
}

func elemento(_ e: AXUIElement, _ nombre: String) -> AXUIElement? {
  guard let v = valor(e, nombre), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
  return (v as! AXUIElement)
}

func lista(_ e: AXUIElement, _ nombre: String) -> [AXUIElement] {
  guard let v = valor(e, nombre), CFGetTypeID(v) == CFArrayGetTypeID() else { return [] }
  return ((v as! CFArray) as? [AXUIElement]) ?? []
}

func hijos(_ e: AXUIElement) -> [AXUIElement] { lista(e, "AXChildren") }

func marco(_ e: AXUIElement) -> CGRect? {
  guard let p = valor(e, "AXPosition"), CFGetTypeID(p) == AXValueGetTypeID(),
        let s = valor(e, "AXSize"), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
  var punto = CGPoint.zero
  var tam = CGSize.zero
  guard AXValueGetValue(p as! AXValue, .cgPoint, &punto), AXValueGetValue(s as! AXValue, .cgSize, &tam) else { return nil }
  return CGRect(origin: punto, size: tam)
}

func rectJson(_ r: CGRect?) -> Any {
  guard let r, r.width > 0, r.height > 0 else { return NSNull() }
  return ["x": Int(r.origin.x.rounded()), "y": Int(r.origin.y.rounded()), "ancho": Int(r.width.rounded()), "alto": Int(r.height.rounded())]
}

func ajustable(_ e: AXUIElement, _ nombre: String) -> Bool {
  var si: DarwinBoolean = false
  return AXUIElementIsAttributeSettable(e, nombre as CFString, &si) == .success && si.boolValue
}

func hacer(_ e: AXUIElement, _ accion: String) -> Bool {
  AXUIElementPerformAction(e, accion as CFString) == .success
}

func numeroVentana(_ w: AXUIElement) -> Int {
  var n: CGWindowID = 0
  return _AXUIElementGetWindow(w, &n) == .success ? Int(n) : 0
}

/** Pide a las apps de Electron y Chromium que expongan su contenido (como hace VoiceOver). */
func despertarAccesibilidad(_ app: AXUIElement, bundle: String) {
  AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  if CHROMIUM.contains(bundle) {
    AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
  }
}

/** Primer descendiente con ese rol (búsqueda en anchura, con tope para no recorrer webs enormes). */
func buscarRol(_ raiz: AXUIElement, _ rol: String, tope: Int = 4000) -> AXUIElement? {
  var cola = [raiz]
  var i = 0
  while i < cola.count && i < tope {
    let e = cola[i]
    i += 1
    if texto(e, "AXRole") == rol { return e }
    cola.append(contentsOf: hijos(e))
  }
  return nil
}

func recortar(_ s: String, _ max: Int) -> String {
  s.count > max ? String(s.prefix(max)) : s
}

/** Lo que el usuario ve escrito en un elemento: su título, su descripción o, en filas y celdas, su primer texto. */
func nombreDe(_ e: AXUIElement) -> String {
  for atributo in ["AXTitle", "AXDescription", "AXLabel", "AXHelp", "AXPlaceholderValue"] {
    if let t = texto(e, atributo)?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty { return t }
  }
  if let titulo = elemento(e, "AXTitleUIElement"), let t = texto(titulo, "AXValue"), !t.isEmpty { return t }
  let rol = texto(e, "AXRole") ?? ""
  if rol == "AXRow" || rol == "AXCell" || rol == "AXLink" || rol == "AXButton" {
    var cola = hijos(e)
    var i = 0
    while i < cola.count && i < 40 {
      let h = cola[i]
      i += 1
      if texto(h, "AXRole") == "AXStaticText", let t = texto(h, "AXValue")?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty { return t }
      cola.append(contentsOf: hijos(h))
    }
  }
  return ""
}

let CAMPO_SECRETO = try! NSRegularExpression(
  pattern: "contrase|password|passwd|passcode|clave|c[oó]digo|\\bcode\\b|otp|\\bpin\\b|cvv|cvc|verificaci|token|2fa|seguridad",
  options: [.caseInsensitive]
)

/** Un campo de contraseña o de código: ahí escribe el usuario, nunca Orbe. Si no se puede comprobar, se trata como tal. */
func esSecreto(_ e: AXUIElement) -> Bool {
  if texto(e, "AXSubrole") == "AXSecureTextField" { return true }
  guard texto(e, "AXRole") != nil else { return true }
  let pista = [nombreDe(e), texto(e, "AXIdentifier") ?? "", texto(e, "AXPlaceholderValue") ?? ""].joined(separator: " ")
  return CAMPO_SECRETO.firstMatch(in: pista, range: NSRange(pista.startIndex..., in: pista)) != nil
}

// MARK: - Ventanas del sistema

func infoVentanas(_ opciones: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]) -> [[String: Any]] {
  (CGWindowListCopyWindowInfo(opciones, kCGNullWindowID) as? [[String: Any]]) ?? []
}

func infoDe(_ n: Int) -> [String: Any]? {
  guard n > 0 else { return nil }
  return (CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(n)) as? [[String: Any]])?.first
}

func pidDe(info: [String: Any]?) -> pid_t? {
  (info?[kCGWindowOwnerPID as String] as? Int).map { pid_t($0) }
}

func rectCG(_ info: [String: Any]?) -> CGRect? {
  guard let b = info?[kCGWindowBounds as String] as? NSDictionary else { return nil }
  return CGRect(dictionaryRepresentation: b as CFDictionary)
}

/** El elemento de Accesibilidad de una ventana del sistema, si existe y su app lo expone. */
func ventanaAX(_ n: Int) -> (AXUIElement, pid_t)? {
  guard let pid = pidDe(info: infoDe(n)) else { return nil }
  let app = AXUIElementCreateApplication(pid)
  for w in lista(app, "AXWindows") where numeroVentana(w) == n { return (w, pid) }
  return nil
}

func procesoDe(_ app: NSRunningApplication?) -> String {
  if let nombre = app?.executableURL?.lastPathComponent, !nombre.isEmpty { return nombre.lowercased() }
  return (app?.localizedName ?? "desconocido").lowercased()
}

/** Pantallas enteras: la ventana del borde de Orbe las cubre y no recibe clics, así que no cuenta como «de Orbe». */
func pantallas() -> [CGRect] {
  var ids = [CGDirectDisplayID](repeating: 0, count: 16)
  var cuantas: UInt32 = 0
  guard CGGetActiveDisplayList(16, &ids, &cuantas) == .success else { return [] }
  return ids.prefix(Int(cuantas)).map { CGDisplayBounds($0) }
}

/** La primera ventana visible en un punto (de delante hacia atrás). Se saltan el Dock, la barra de menús y los avisos
 *  del sistema (capas 20 y superiores), salvo los menús desplegables (capa 101), que sí son de la app. */
func ventanaEnPunto(_ p: CGPoint, saltarCubrePantalla: Bool) -> [String: Any]? {
  let enteras = saltarCubrePantalla ? pantallas() : []
  for info in infoVentanas() {
    guard let r = rectCG(info), r.contains(p) else { continue }
    let capa = info[kCGWindowLayer as String] as? Int ?? 0
    if capa >= 20 && capa != 101 { continue }
    if (info[kCGWindowAlpha as String] as? Double ?? 1) <= 0 { continue }
    if saltarCubrePantalla, enteras.contains(where: { abs($0.width - r.width) < 2 && abs($0.height - r.height) < 2 && abs($0.minX - r.minX) < 2 && abs($0.minY - r.minY) < 2 }) { continue }
    return info
  }
  return nil
}

// MARK: - Entrada simulada (ratón y teclado)

/** Marca de los eventos que simula Orbe: la vigilancia los ignora (en Windows, la marca «inyectado»). */
let MARCA_ORBE: Int64 = 0x4F52_4245 // «ORBE»
let FUENTE_EVENTOS = CGEventSource(stateID: .hidSystemState)

func publicar(_ e: CGEvent?) throws {
  guard let e else { throw FalloHelper(mensaje: "macOS no dejó simular la entrada (¿falta el permiso de Accesibilidad?).") }
  e.setIntegerValueField(.eventSourceUserData, value: MARCA_ORBE)
  e.post(tap: .cghidEventTap)
}

/** Códigos de tecla virtual de Windows (los que manda Orbe) → teclas de macOS. Ctrl se convierte en ⌘: lo que en
 *  Windows es Ctrl+C, en macOS es ⌘C. */
let TECLAS_MAC: [Int: CGKeyCode] = {
  var t: [Int: CGKeyCode] = [
    0x0D: 36, 0x09: 48, 0x1B: 53, 0x20: 49, 0x08: 51, 0x2E: 117, 0x24: 115, 0x23: 119, 0x21: 116, 0x22: 121,
    0x25: 123, 0x27: 124, 0x28: 125, 0x26: 126
  ]
  let letras: [CGKeyCode] = [0, 11, 8, 2, 14, 3, 5, 4, 34, 38, 40, 37, 46, 45, 31, 35, 12, 15, 1, 17, 32, 9, 13, 7, 16, 6]
  for (i, k) in letras.enumerated() { t[0x41 + i] = k }
  let cifras: [CGKeyCode] = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25]
  for (i, k) in cifras.enumerated() { t[0x30 + i] = k }
  let funciones: [CGKeyCode] = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90]
  for (i, k) in funciones.enumerated() { t[0x70 + i] = k }
  return t
}()

/** Modificadores: tecla de Windows → (tecla de macOS, bandera). */
let MODIFICADORES: [Int: (CGKeyCode, CGEventFlags)] = [
  0x10: (56, .maskShift), 0x11: (55, .maskCommand), 0x12: (58, .maskAlternate)
]

// MARK: - Vigilancia de la entrada del usuario

var vigilando = false
var pidOrbeGlobal: pid_t = 0
var baseRaton: CGPoint? = nil
var tapEntrada: CFMachPort? = nil

func avisar(_ que: String) {
  guard vigilando else { return }
  vigilando = false
  escribir(["tipo": "usuario", "que": que])
}

func deOrbe(_ p: CGPoint) -> Bool {
  pidDe(info: ventanaEnPunto(p, saltarCubrePantalla: true)) == pidOrbeGlobal
}

func manejarEntrada(_ tipo: CGEventType, _ e: CGEvent) {
  if tipo == .tapDisabledByTimeout || tipo == .tapDisabledByUserInput {
    if let t = tapEntrada { CGEvent.tapEnable(tap: t, enable: true) }
    return
  }
  guard vigilando, e.getIntegerValueField(.eventSourceUserData) != MARCA_ORBE else { return }
  switch tipo {
  case .keyDown:
    let esc = e.getIntegerValueField(.keyboardEventKeycode) == 53
    // Esc siempre para; el resto, salvo si escribes en Orbe.
    if esc || NSWorkspace.shared.frontmostApplication?.processIdentifier != pidOrbeGlobal { avisar(esc ? "esc" : "teclado") }
  case .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel:
    if !deOrbe(e.location) { avisar("raton") }
  case .mouseMoved, .leftMouseDragged, .rightMouseDragged:
    let p = e.location
    guard let base = baseRaton else { baseRaton = p; return }
    // No por un temblor.
    if abs(p.x - base.x) + abs(p.y - base.y) > 12 && !deOrbe(p) { avisar("raton") }
  default:
    break
  }
}

/** Escucha el ratón y el teclado de todo el sistema (necesita el permiso de Accesibilidad). No cambia ningún evento. */
func prepararVigilancia() throws {
  if tapEntrada != nil { return }
  let tipos: [CGEventType] = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .mouseMoved, .leftMouseDragged, .rightMouseDragged]
  let mascara = tipos.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << CGEventMask($1.rawValue)) }
  let llamada: CGEventTapCallBack = { _, tipo, evento, _ in
    manejarEntrada(tipo, evento)
    return Unmanaged.passUnretained(evento)
  }
  guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                    eventsOfInterest: mascara, callback: llamada, userInfo: nil) else {
    throw FalloHelper(mensaje: PERMISO_ACCESIBILIDAD)
  }
  tapEntrada = tap
  CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0), .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
}

// MARK: - Servidor

/** Roles que se pueden usar (como los ControlType interactivos de Windows) y cómo se llaman en español. */
let INTERACTIVOS: [String: String] = [
  "AXButton": "botón", "AXMenuButton": "botón", "AXPopUpButton": "desplegable", "AXComboBox": "desplegable",
  "AXTextField": "campo", "AXTextArea": "campo", "AXCheckBox": "casilla", "AXRadioButton": "opción", "AXLink": "enlace",
  "AXMenuItem": "menú", "AXRow": "elemento", "AXSlider": "control deslizante", "AXIncrementor": "número",
  "AXDisclosureTriangle": "desplegable"
]
let MAX_ELEMENTOS = 250

final class Servidor {
  let pidOrbe: pid_t
  /** La última app que estuvo delante y no era Orbe: al abrir el panel, Orbe pasa delante y hay que leer la anterior. */
  var ultimaApp: NSRunningApplication?
  var ultimoPid: pid_t = 0
  var permisoPedido = false
  /** La última lista numerada de pc_ver y de qué ventana es (los números de `actuar` se refieren a ella). */
  var listaElementos: [AXUIElement] = []
  var listaVentana = 0

  init(pidOrbe: pid_t) {
    self.pidOrbe = pidOrbe
    pidOrbeGlobal = pidOrbe
    // Una app colgada no debe colgar a Orbe: cada consulta de Accesibilidad espera como mucho 4 s.
    AXUIElementSetMessagingTimeout(SISTEMA, 4)
    if let f = NSWorkspace.shared.frontmostApplication, !esOrbe(f) { ultimaApp = f }
    NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] aviso in
      guard let self, let app = aviso.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
      if !self.esOrbe(app) { self.ultimaApp = app }
    }
  }

  func esOrbe(_ app: NSRunningApplication) -> Bool {
    app.processIdentifier == pidOrbe || app.processIdentifier == getpid()
  }

  func appObjetivo() -> NSRunningApplication? {
    if let f = NSWorkspace.shared.frontmostApplication, !esOrbe(f) { return f }
    if let u = ultimaApp, !u.isTerminated { return u }
    return nil
  }

  /** Comprueba el permiso; la primera vez que falta, macOS muestra su aviso para concederlo. */
  func exigirPermiso() throws {
    if AXIsProcessTrusted() { return }
    if !permisoPedido {
      permisoPedido = true
      let opciones = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
      _ = AXIsProcessTrustedWithOptions(opciones)
    }
    throw FalloHelper(mensaje: PERMISO_ACCESIBILIDAD)
  }

  /** La ventana pedida por número, o la que el usuario estaba usando (la de delante de la última app que no es Orbe). */
  func resolver(_ pedido: Int) -> (numero: Int, pid: pid_t, ax: AXUIElement?)? {
    let confiable = AXIsProcessTrusted()
    if pedido > 0 {
      guard let pid = pidDe(info: infoDe(pedido)) else { return nil }
      let ax: AXUIElement? = confiable ? lista(AXUIElementCreateApplication(pid), "AXWindows").first(where: { numeroVentana($0) == pedido }) : nil
      return (pedido, pid, ax)
    }
    guard let app = appObjetivo() else { return nil }
    let pid = app.processIdentifier
    var ax: AXUIElement? = nil
    var n = 0
    if confiable {
      let elApp = AXUIElementCreateApplication(pid)
      despertarAccesibilidad(elApp, bundle: app.bundleIdentifier ?? "")
      ax = elemento(elApp, "AXFocusedWindow") ?? elemento(elApp, "AXMainWindow")
      n = ax.map(numeroVentana) ?? 0
    }
    if n == 0 {
      // La lista va de delante hacia atrás: la primera ventana normal (capa 0) de la app es la de encima.
      let delante = infoVentanas().first(where: { pidDe(info: $0) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 })
      n = (delante?[kCGWindowNumber as String] as? Int) ?? 0
    }
    return (n, pid, ax)
  }

  /** Lo que se sabe de una ventana, con los campos de `VentanaUia` / `VentanaPc`. */
  func ventana(_ pedido: Int) -> Any {
    guard let r = resolver(pedido) else { return NSNull() }
    ultimoPid = r.pid
    let app = NSRunningApplication(processIdentifier: r.pid)
    let bundle = app?.bundleIdentifier ?? ""
    let info = infoDe(r.numero)
    var titulo = r.ax.flatMap { texto($0, "AXTitle") } ?? ""
    if titulo.isEmpty { titulo = (info?[kCGWindowName as String] as? String) ?? "" }
    let esNavegador = NAVEGADORES.contains(bundle)
    var url: Any = NSNull()
    if esNavegador, let w = r.ax, let web = buscarRol(w, "AXWebArea"), let u = texto(web, "AXURL"), !u.isEmpty { url = u }
    let datos: [String: Any] = [
      "hwnd": r.numero,
      "pid": Int(r.pid),
      "proceso": procesoDe(app),
      "aplicacion": app?.localizedName ?? procesoDe(app),
      "titulo": titulo,
      "esNavegador": esNavegador,
      "url": url,
      "barra": NSNull(),
      "primerPlano": NSWorkspace.shared.frontmostApplication?.processIdentifier == r.pid,
      "restringida": !AXIsProcessTrusted(),
      "rect": rectJson(r.ax.flatMap(marco) ?? rectCG(info))
    ]
    return datos
  }

  /** El elemento ventana de Accesibilidad de un número; si no se encuentra, el de delante de su app. */
  func axDe(_ n: Int) throws -> (AXUIElement, pid_t) {
    if let par = ventanaAX(n) { return par }
    var pidPedido: pid_t? = ultimoPid > 0 ? ultimoPid : nil
    if n > 0 { pidPedido = pidDe(info: infoDe(n)) }
    guard let pid = pidPedido else {
      throw FalloHelper(mensaje: "Esa ventana ya no existe: vuelve a mirar con pc_ver.")
    }
    let elApp = AXUIElementCreateApplication(pid)
    guard let w = elemento(elApp, "AXFocusedWindow") ?? elemento(elApp, "AXMainWindow") else {
      throw FalloHelper(mensaje: "No encuentro esa ventana: vuelve a mirar con pc_ver.")
    }
    return (w, pid)
  }

  // MARK: Lector de pantalla

  func seleccion(_ n: Int, _ max: Int) throws -> [String: Any] {
    try exigirPermiso()
    let pid = n > 0 ? (pidDe(info: infoDe(n)) ?? ultimoPid) : ultimoPid
    guard pid > 0 else { return ["texto": NSNull(), "metodo": NSNull()] }
    let elApp = AXUIElementCreateApplication(pid)
    if let foco = elemento(elApp, "AXFocusedUIElement"), !esSecreto(foco), let t = texto(foco, "AXSelectedText"), !t.isEmpty {
      return ["texto": recortar(t, max), "metodo": "AXSelectedText"]
    }
    return ["texto": NSNull(), "metodo": NSNull()]
  }

  func contenido(_ n: Int, _ max: Int) throws -> [String: Any] {
    try exigirPermiso()
    guard let par = try? axDe(n) else { return ["texto": NSNull(), "metodo": NSNull(), "parcial": false] }
    let (w, pid) = par
    let bundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
    despertarAccesibilidad(AXUIElementCreateApplication(pid), bundle: bundle)
    // En un navegador, solo la página (sin pestañas ni barras); si Chromium aún no ha construido el árbol, se espera un poco.
    var raiz = buscarRol(w, "AXWebArea")
    if raiz == nil && CHROMIUM.contains(bundle) {
      Thread.sleep(forTimeInterval: 0.4)
      raiz = buscarRol(w, "AXWebArea")
    }
    let metodo = raiz == nil ? "AXVentana" : "AXWebArea"
    var partes: [String] = []
    var total = 0
    var visitados = 0
    var parcial = false
    let limite = Date().addingTimeInterval(8)
    func recorrer(_ e: AXUIElement, _ profundidad: Int) {
      if total >= max || visitados >= 12_000 || Date() > limite {
        parcial = true
        return
      }
      visitados += 1
      let rol = texto(e, "AXRole") ?? ""
      if rol == "AXTextArea" || rol == "AXTextField" {
        // Su valor ya es todo el texto: sus hijos lo repetirían. Los campos de contraseña no se leen.
        if !esSecreto(e), let v = texto(e, "AXValue"), !v.isEmpty {
          partes.append(v)
          total += v.count + 1
        }
        return
      }
      if rol == "AXStaticText" {
        if let v = texto(e, "AXValue") ?? texto(e, "AXTitle") ?? texto(e, "AXDescription"), !v.isEmpty {
          partes.append(v)
          total += v.count + 1
        }
      }
      if profundidad < 80 {
        for h in hijos(e) { recorrer(h, profundidad + 1) }
      }
    }
    recorrer(raiz ?? w, 0)
    let unido = partes.joined(separator: "\n")
    if unido.isEmpty { return ["texto": NSNull(), "metodo": metodo, "parcial": parcial] }
    return ["texto": recortar(unido, max), "metodo": metodo, "parcial": parcial || unido.count > max]
  }

  // MARK: Control del PC: ver

  func elementos(_ pedido: Int) throws -> [String: Any] {
    try exigirPermiso()
    let info = ventana(pedido)
    guard let datos = info as? [String: Any], let n = datos["hwnd"] as? Int, n > 0, let par = try? axDe(n) else {
      return ["ventana": info, "elementos": [Any](), "parcial": false]
    }
    let (w, pid) = par
    let bundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
    despertarAccesibilidad(AXUIElementCreateApplication(pid), bundle: bundle)
    let zona = marco(w)
    var nuevos: [AXUIElement] = []
    var salida: [Any] = []
    var parcial = false
    var cola = [w]
    var i = 0
    let limite = Date().addingTimeInterval(6)
    while i < cola.count {
      if nuevos.count >= MAX_ELEMENTOS || i >= 15_000 || Date() > limite {
        parcial = true
        break
      }
      let e = cola[i]
      i += 1
      let rol = texto(e, "AXRole") ?? ""
      // Dentro de un campo de texto no hay nada más que usar.
      if rol != "AXTextArea" && rol != "AXTextField" { cola.append(contentsOf: hijos(e)) }
      guard let tipoBase = INTERACTIVOS[rol], let r = marco(e), r.width > 0, r.height > 0 else { continue }
      if let zona, !zona.intersects(r) { continue } // fuera de la vista
      let subrol = texto(e, "AXSubrole") ?? ""
      let nombre = nombreDe(e)
      let secreto = esSecreto(e)
      var valorTexto: String? = nil
      if !secreto, let v = texto(e, "AXValue"), !v.isEmpty, rol != "AXStaticText" {
        valorTexto = v.count > 120 ? String(v.prefix(120)) + "…" : v
      }
      let esCampo = rol == "AXTextField" || rol == "AXTextArea" || rol == "AXComboBox"
      if nombre.isEmpty && (valorTexto ?? "").isEmpty && !esCampo { continue }
      var estados: [String] = []
      if logico(e, "AXEnabled") == false { estados.append("desactivado") }
      if logico(e, "AXFocused") == true { estados.append("con el foco") }
      if secreto { estados.append("contraseña o código: no se escribe aquí") }
      if rol == "AXCheckBox" || subrol == "AXSwitch" {
        estados.append(numero(e, "AXValue") == 1 ? "marcado" : "sin marcar")
        valorTexto = nil
      }
      if let expandido = logico(e, "AXExpanded") { estados.append(expandido ? "desplegado" : "plegado") }
      if logico(e, "AXSelected") == true { estados.append("seleccionado") }
      var tipo = tipoBase
      if subrol == "AXTabButton" { tipo = "pestaña" }
      if subrol == "AXSwitch" { tipo = "interruptor" }
      if subrol == "AXSearchField" { tipo = "buscador" }
      nuevos.append(e)
      let fila: [String: Any] = [
        "n": nuevos.count, "tipo": tipo, "nombre": nombre, "valor": valorTexto ?? NSNull(),
        "estado": estados.joined(separator: ", "), "rect": rectJson(r)
      ]
      salida.append(fila)
    }
    listaElementos = nuevos
    listaVentana = n
    return ["ventana": datos, "elementos": salida, "parcial": parcial]
  }

  /** Ventanas abiertas de las apps normales (sin Orbe ni el sistema), como `Control.Ventanas` de Windows. */
  func ventanas() -> [String: Any] {
    var salida: [Any] = []
    var vistos = Set<Int>()
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular && !esOrbe(app) {
      if salida.count >= 40 { break }
      if AXIsProcessTrusted() {
        for w in lista(AXUIElementCreateApplication(app.processIdentifier), "AXWindows") {
          let n = numeroVentana(w)
          let titulo = texto(w, "AXTitle") ?? ""
          guard n > 0, !titulo.trimmingCharacters(in: .whitespaces).isEmpty, !vistos.contains(n), salida.count < 40 else { continue }
          vistos.insert(n)
          let fila: [String: Any] = ["hwnd": n, "titulo": titulo, "proceso": procesoDe(app), "minimizada": logico(w, "AXMinimized") ?? false]
          salida.append(fila)
        }
      }
    }
    if salida.isEmpty {
      // Sin Accesibilidad: las ventanas que dice el sistema (sus títulos solo salen con el permiso de Grabación de pantalla).
      for info in infoVentanas() where (info[kCGWindowLayer as String] as? Int) == 0 {
        guard let pid = pidDe(info: info), pid != pidOrbe, let n = info[kCGWindowNumber as String] as? Int, salida.count < 40 else { continue }
        let app = NSRunningApplication(processIdentifier: pid)
        guard app?.activationPolicy == .regular else { continue }
        let titulo = (info[kCGWindowName as String] as? String) ?? (app?.localizedName ?? "")
        let fila: [String: Any] = ["hwnd": n, "titulo": titulo, "proceso": procesoDe(app), "minimizada": false]
        salida.append(fila)
      }
    }
    return ["ventanas": salida]
  }

  // MARK: Control del PC: actuar por accesibilidad

  func actuar(_ peticion: [String: Any]) throws -> [String: Any] {
    try exigirPermiso()
    let n = (peticion["hwnd"] as? NSNumber)?.intValue ?? 0
    let accion = peticion["accion"] as? String ?? ""
    let numeroElemento = (peticion["n"] as? NSNumber)?.intValue ?? 0
    let e: AXUIElement
    if accion == "desplazar" && numeroElemento == 0 {
      e = try axDe(n).0
    } else {
      guard listaVentana == n, numeroElemento >= 1, numeroElemento <= listaElementos.count else {
        throw FalloHelper(mensaje: "No tengo el elemento \(numeroElemento) de esa ventana: vuelve a mirar con pc_ver.")
      }
      e = listaElementos[numeroElemento - 1]
    }
    guard texto(e, "AXRole") != nil else { throw FalloHelper(mensaje: "Ese elemento ya no está en la ventana: vuelve a mirar con pc_ver.") }
    let nombre = nombreDe(e)
    if accion == "escribir" && esSecreto(e) { throw FalloHelper(mensaje: "Es un campo de contraseña o de código: ahí escribe el usuario, nunca Orbe.") }
    let hecho = try hacerAccion(e, accion, peticion["texto"] as? String, peticion["direccion"] as? String)
    return ["nombre": nombre, "hecho": hecho]
  }

  func hacerAccion(_ e: AXUIElement, _ accion: String, _ textoNuevo: String?, _ direccion: String?) throws -> String {
    switch accion {
    case "pulsar":
      for a in ["AXPress", "AXPick", "AXConfirm", "AXShowMenu"] where hacer(e, a) { return a == "AXShowMenu" ? "menú abierto" : "pulsado" }
      if ajustable(e, "AXSelected") && AXUIElementSetAttributeValue(e, "AXSelected" as CFString, kCFBooleanTrue) == .success { return "seleccionado" }
      throw FalloHelper(mensaje: "Ese elemento no se puede pulsar por accesibilidad: usa pc_clic en su posición.")
    case "escribir":
      guard ajustable(e, "AXValue") else {
        throw FalloHelper(mensaje: "Ese elemento no admite texto por accesibilidad: pulsa en él y usa pc_escribir_texto.")
      }
      AXUIElementSetAttributeValue(e, "AXFocused" as CFString, kCFBooleanTrue)
      guard AXUIElementSetAttributeValue(e, "AXValue" as CFString, (textoNuevo ?? "") as CFString) == .success else {
        throw FalloHelper(mensaje: "La aplicación no aceptó el texto: pulsa en el campo y usa pc_escribir_texto.")
      }
      return "escrito"
    case "marcar":
      guard texto(e, "AXRole") == "AXCheckBox" || texto(e, "AXSubrole") == "AXSwitch" else { throw FalloHelper(mensaje: "Ese elemento no es una casilla.") }
      guard hacer(e, "AXPress") else { throw FalloHelper(mensaje: "No pude cambiar esa casilla: usa pc_clic en su posición.") }
      Thread.sleep(forTimeInterval: 0.15)
      return "ahora " + (numero(e, "AXValue") == 1 ? "marcado" : "sin marcar")
    case "elegir":
      if ajustable(e, "AXSelected") && AXUIElementSetAttributeValue(e, "AXSelected" as CFString, kCFBooleanTrue) == .success { return "elegido" }
      if hacer(e, "AXPick") || hacer(e, "AXPress") { return "elegido" }
      throw FalloHelper(mensaje: "Ese elemento no se puede elegir.")
    case "desplegar":
      if let expandido = logico(e, "AXExpanded"), ajustable(e, "AXExpanded") {
        AXUIElementSetAttributeValue(e, "AXExpanded" as CFString, expandido ? kCFBooleanFalse : kCFBooleanTrue)
        return expandido ? "plegado" : "desplegado"
      }
      if hacer(e, "AXShowMenu") || hacer(e, "AXPress") { return "desplegado o plegado" }
      throw FalloHelper(mensaje: "Ese elemento no se despliega.")
    case "desplazar":
      if direccion == "hasta" {
        guard hacer(e, "AXScrollToVisible") else { throw FalloHelper(mensaje: "No puedo llevar la vista hasta ese elemento.") }
        return "a la vista"
      }
      guard let r = marco(e) else { throw FalloHelper(mensaje: "No encuentro nada que se pueda desplazar ahí: prueba con pc_teclas («AvPág»).") }
      // La rueda del ratón en el centro del elemento (el equivalente de ScrollPattern): 400 puntos por paso.
      var dy: Int32 = -400
      var dx: Int32 = 0
      if direccion == "arriba" { dy = 400 }
      if direccion == "izquierda" { dy = 0; dx = 400 }
      if direccion == "derecha" { dy = 0; dx = -400 }
      let rueda = CGEvent(scrollWheelEvent2Source: FUENTE_EVENTOS, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
      rueda?.location = CGPoint(x: r.midX, y: r.midY)
      try publicar(rueda)
      return "desplazado"
    default:
      throw FalloHelper(mensaje: "Acción desconocida: \(accion)")
    }
  }

  // MARK: Control del PC: ventanas, ratón y teclado

  /** Trae la ventana al frente (la saca del Dock si estaba minimizada) y comprueba que lo está. */
  func asegurarPrimerPlano(_ n: Int) throws {
    let (w, pid) = try axDe(n)
    // Se pregunta a la propia app (AXFrontmost): NSWorkspace solo se actualiza cuando el hilo principal queda libre.
    let elApp = AXUIElementCreateApplication(pid)
    if logico(elApp, "AXFrontmost") == true, logico(w, "AXMain") == true, logico(w, "AXMinimized") != true { return }
    if logico(w, "AXMinimized") == true { AXUIElementSetAttributeValue(w, "AXMinimized" as CFString, kCFBooleanFalse) }
    // Desde macOS 14, activate() de una app en segundo plano puede no hacer nada: AXFrontmost sí la trae.
    NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateIgnoringOtherApps])
    AXUIElementSetAttributeValue(elApp, "AXFrontmost" as CFString, kCFBooleanTrue)
    _ = hacer(w, "AXRaise")
    AXUIElementSetAttributeValue(w, "AXMain" as CFString, kCFBooleanTrue)
    for _ in 0..<20 {
      if logico(elApp, "AXFrontmost") == true { return }
      Thread.sleep(forTimeInterval: 0.05)
    }
    throw FalloHelper(mensaje: "macOS no dejó traer esa ventana al frente: pídele al usuario que la abra él.")
  }

  func enfocar(_ n: Int) throws -> [String: Any] {
    try exigirPermiso()
    try asegurarPrimerPlano(n)
    return ["titulo": (try? axDe(n)).flatMap { texto($0.0, "AXTitle") } ?? ""]
  }

  func punto(_ x: Int, _ y: Int) -> [String: Any] {
    let p = CGPoint(x: x, y: y)
    let info = ventanaEnPunto(p, saltarCubrePantalla: true)
    var el: AXUIElement?
    var nombre: Any = NSNull()
    if AXIsProcessTrusted(), AXUIElementCopyElementAtPosition(SISTEMA, Float(x), Float(y), &el) == .success, let el {
      let t = nombreDe(el)
      if !t.isEmpty { nombre = t }
    }
    return ["hwnd": (info?[kCGWindowNumber as String] as? Int) ?? 0, "nombre": nombre]
  }

  func clic(_ n: Int, _ x: Int, _ y: Int, derecho: Bool, doble: Bool) throws -> [String: Any] {
    try exigirPermiso()
    try asegurarPrimerPlano(n)
    let p = CGPoint(x: x, y: y)
    guard let info = ventanaEnPunto(p, saltarCubrePantalla: true), pidDe(info: info) == pidDe(info: infoDe(n)) else {
      throw FalloHelper(mensaje: "En ese punto no está la ventana (hay otra encima o queda fuera): vuelve a mirar con pc_ver.")
    }
    let (bajar, subir, boton): (CGEventType, CGEventType, CGMouseButton) = derecho ? (.rightMouseDown, .rightMouseUp, .right) : (.leftMouseDown, .leftMouseUp, .left)
    try publicar(CGEvent(mouseEventSource: FUENTE_EVENTOS, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
    for vez in 1...(doble ? 2 : 1) {
      let abajo = CGEvent(mouseEventSource: FUENTE_EVENTOS, mouseType: bajar, mouseCursorPosition: p, mouseButton: boton)
      let arriba = CGEvent(mouseEventSource: FUENTE_EVENTOS, mouseType: subir, mouseCursorPosition: p, mouseButton: boton)
      abajo?.setIntegerValueField(.mouseEventClickState, value: Int64(vez))
      arriba?.setIntegerValueField(.mouseEventClickState, value: Int64(vez))
      try publicar(abajo)
      try publicar(arriba)
    }
    return ["hecho": true]
  }

  func teclas(_ n: Int, _ vks: [Int]) throws -> [String: Any] {
    try exigirPermiso()
    if vks.isEmpty || vks.count > 4 { throw FalloHelper(mensaje: "Combinación de teclas no válida.") }
    if vks.contains(0x5B) || vks.contains(0x5C) { throw FalloHelper(mensaje: "La tecla Windows no se usa.") }
    var banderas: CGEventFlags = []
    var modificadores: [CGKeyCode] = []
    var normales: [CGKeyCode] = []
    for vk in vks {
      if let m = MODIFICADORES[vk] {
        banderas.insert(m.1)
        modificadores.append(m.0)
      } else if let tecla = TECLAS_MAC[vk] {
        normales.append(tecla)
      } else {
        throw FalloHelper(mensaje: "Esa tecla no existe en el Mac.")
      }
    }
    try asegurarPrimerPlano(n)
    // Solo modificadores (p. ej. «Mayús»): se pulsan esas teclas.
    let pulsar = normales.isEmpty ? modificadores : normales
    for tecla in pulsar {
      let abajo = CGEvent(keyboardEventSource: FUENTE_EVENTOS, virtualKey: tecla, keyDown: true)
      let arriba = CGEvent(keyboardEventSource: FUENTE_EVENTOS, virtualKey: tecla, keyDown: false)
      abajo?.flags = banderas
      arriba?.flags = banderas
      try publicar(abajo)
      try publicar(arriba)
    }
    return ["hecho": true]
  }

  func escribirTexto(_ n: Int, _ contenido: String) throws -> [String: Any] {
    try exigirPermiso()
    try asegurarPrimerPlano(n)
    guard let foco = elemento(SISTEMA, "AXFocusedUIElement"), !esSecreto(foco) else {
      throw FalloHelper(mensaje: "El cursor está en un campo de contraseña o de código (o no sé dónde está): ahí escribe el usuario.")
    }
    // Por trozos (cada evento lleva como mucho 20 caracteres); los saltos de línea, como Intro.
    for (i, linea) in contenido.components(separatedBy: "\n").enumerated() {
      if i > 0 {
        try publicar(CGEvent(keyboardEventSource: FUENTE_EVENTOS, virtualKey: 36, keyDown: true))
        try publicar(CGEvent(keyboardEventSource: FUENTE_EVENTOS, virtualKey: 36, keyDown: false))
      }
      var unidades = Array(linea.utf16)
      while !unidades.isEmpty {
        var trozo = Array(unidades.prefix(20))
        unidades.removeFirst(trozo.count)
        for abajo in [true, false] {
          let e = CGEvent(keyboardEventSource: FUENTE_EVENTOS, virtualKey: 0, keyDown: abajo)
          e?.keyboardSetUnicodeString(stringLength: trozo.count, unicodeString: &trozo)
          try publicar(e)
        }
      }
    }
    return ["hecho": true]
  }

  func vigilar(_ activo: Bool) throws -> [String: Any] {
    if activo { try prepararVigilancia() }
    baseRaton = nil
    vigilando = activo
    return ["vigilando": activo]
  }

  // MARK: Peticiones

  func manejar(_ linea: String) {
    guard let datos = linea.data(using: .utf8),
          let peticion = (try? JSONSerialization.jsonObject(with: datos)) as? [String: Any],
          let id = (peticion["id"] as? NSNumber)?.intValue,
          let op = peticion["op"] as? String else { return }
    let entero = { (clave: String) -> Int in (peticion[clave] as? NSNumber)?.intValue ?? 0 }
    let n = entero("hwnd")
    let max = Swift.max(1, (peticion["max"] as? NSNumber)?.intValue ?? 20_000)
    do {
      let respuesta: Any
      switch op {
      case "ping": respuesta = ["pong": true]
      case "ventana": respuesta = ["ventana": ventana(n)]
      case "seleccion": respuesta = try seleccion(n, max)
      case "contenido": respuesta = try contenido(n, max)
      case "elementos": respuesta = try elementos(n)
      case "actuar": respuesta = try actuar(peticion)
      case "ventanas": respuesta = ventanas()
      case "enfocar": respuesta = try enfocar(n)
      case "punto": respuesta = punto(entero("x"), entero("y"))
      case "clic": respuesta = try clic(n, entero("x"), entero("y"), derecho: (peticion["boton"] as? String) == "derecho", doble: entero("doble") == 1)
      case "teclas": respuesta = try teclas(n, ((peticion["vks"] as? [NSNumber]) ?? []).map { $0.intValue })
      case "texto": respuesta = try escribirTexto(n, peticion["texto"] as? String ?? "")
      case "vigilar": respuesta = try vigilar(entero("activo") == 1)
      default: throw FalloHelper(mensaje: "Operación desconocida: \(op)")
      }
      escribir(["id": id, "ok": true, "datos": respuesta])
    } catch let fallo as FalloHelper {
      escribir(["id": id, "ok": false, "error": fallo.mensaje])
    } catch {
      escribir(["id": id, "ok": false, "error": error.localizedDescription])
    }
  }
}

// MARK: - Arranque

let argumentos = CommandLine.arguments

if argumentos.count >= 3 && argumentos[1] == "ocr" {
  exit(reconocer(argumentos[2]))
}

if argumentos.count >= 2 && argumentos[1] == "servidor" {
  var pid: pid_t = 0
  if let i = argumentos.firstIndex(of: "--pid"), i + 1 < argumentos.count { pid = pid_t(argumentos[i + 1]) ?? 0 }
  let servidor = Servidor(pidOrbe: pid)
  escribir(["tipo": "listo"])
  // La entrada se lee en otro hilo; cada petición se atiende en el principal, que también recibe los avisos de
  // NSWorkspace (qué app pasa delante) y los eventos de la vigilancia. Al cerrarse la entrada (Orbe se cerró), termina.
  Thread.detachNewThread {
    while let linea = readLine() {
      DispatchQueue.main.async { servidor.manejar(linea) }
    }
    DispatchQueue.main.async { exit(0) }
  }
  RunLoop.main.run()
}

FileHandle.standardError.write("uso: orbe-helper ocr <imagen> | orbe-helper servidor --pid <pid>\n".data(using: .utf8)!)
exit(64)

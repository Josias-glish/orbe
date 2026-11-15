#!/bin/sh
# Comprueba el ayudante de macOS recién compilado: responde al protocolo y Vision lee texto de una imagen.
# Sin permiso de Accesibilidad (como en CI) solo se prueba lo que no lo necesita.
set -eu
cd "$(dirname "$0")/.."
helper=helper/mac/orbe-helper
lipo -archs "$helper" | grep -q arm64
lipo -archs "$helper" | grep -q x86_64

salida=$(printf '{"id":1,"op":"ping"}\n{"id":2,"op":"ventanas"}\n' | "$helper" servidor --pid 1)
echo "$salida"
echo "$salida" | grep -q '"tipo":"listo"'
echo "$salida" | grep -q '"pong":true'
echo "$salida" | grep -q '"id":2'

# Una imagen con texto, dibujada por el propio sistema (sips no escribe texto: se usa Swift).
img="${TMPDIR:-/tmp}/orbe-ocr.png"
cat > "${TMPDIR:-/tmp}/orbe-ocr.swift" <<'SWIFT'
import AppKit
let img = NSImage(size: NSSize(width: 800, height: 200))
img.lockFocus()
NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 800, height: 200).fill()
("Hola Orbe 2026" as NSString).draw(at: NSPoint(x: 40, y: 70), withAttributes: [.font: NSFont.systemFont(ofSize: 64), .foregroundColor: NSColor.black])
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
SWIFT
swift "${TMPDIR:-/tmp}/orbe-ocr.swift" "$img"
ocr=$("$helper" ocr "$img")
echo "$ocr"
echo "$ocr" | grep -q '"ok":true'
echo "$ocr" | grep -qi 'orbe'
echo "Ayudante de macOS: bien."

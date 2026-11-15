#!/bin/sh
# Compila helper/mac/main.swift como binario universal (Apple Silicon + Intel) en helper/mac/orbe-helper.
# Solo funciona en un Mac con las herramientas de línea de órdenes de Xcode; en CI lo ejecuta el runner de macOS.
set -eu
cd "$(dirname "$0")/../helper/mac"
for arq in arm64 x86_64; do
  swiftc -O -target "$arq-apple-macos12" -o "orbe-helper-$arq" main.swift
done
lipo -create -output orbe-helper orbe-helper-arm64 orbe-helper-x86_64
rm orbe-helper-arm64 orbe-helper-x86_64
# Firma ad hoc: en Apple Silicon un binario sin ninguna firma no arranca.
codesign --force --sign - orbe-helper
echo "helper/mac/orbe-helper listo: $(lipo -archs orbe-helper)"

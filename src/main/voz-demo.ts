/** Un WAV mudo (PCM de 16 bits, 8 kHz, mono) de esa duración: para la prueba visual de la voz neuronal sin sonar de verdad. */
export function wavSilencioso(milisegundos: number): Uint8Array {
  const frecuencia = 8000
  const muestras = Math.round((frecuencia * milisegundos) / 1000)
  const datos = muestras * 2
  const wav = Buffer.alloc(44 + datos)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + datos, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20) // PCM
  wav.writeUInt16LE(1, 22) // mono
  wav.writeUInt32LE(frecuencia, 24)
  wav.writeUInt32LE(frecuencia * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(datos, 40)
  return new Uint8Array(wav)
}

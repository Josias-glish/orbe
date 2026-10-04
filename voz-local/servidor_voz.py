"""Servidor local de voz para Orbe: Kokoro (modelo neuronal de código abierto) con la API /audio/speech de OpenAI.

Escucha solo en este equipo (127.0.0.1:8880), no envía nada a internet y no necesita clave.
Uso:  .venv\\Scripts\\python.exe servidor_voz.py
"""
import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort
from kokoro_onnx import Kokoro

CARPETA = os.path.dirname(os.path.abspath(__file__))
HOST = os.environ.get("ORBE_VOZ_HOST", "127.0.0.1")
PUERTO = int(os.environ.get("ORBE_VOZ_PUERTO", "8880"))
VOZ_POR_DEFECTO = "em_alex"
MAX_CARACTERES = 1000
MAX_CUERPO = 64 * 1024

# Prefijo de la voz -> idioma que necesita el fonemizador.
IDIOMAS = {"e": "es", "a": "en-us", "b": "en-gb", "f": "fr-fr", "i": "it", "p": "pt-br", "h": "hi", "j": "ja", "z": "cmn"}


def registrar(mensaje: str) -> None:
    print(time.strftime("%H:%M:%S"), mensaje, flush=True)


def crear_modelo() -> Kokoro:
    opciones = ort.SessionOptions()
    # Con todos los núcleos va a ritmo de lectura (con menos se queda más lento que la voz).
    opciones.intra_op_num_threads = os.cpu_count() or 4
    opciones.inter_op_num_threads = 1
    opciones.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sesion = ort.InferenceSession(
        os.path.join(CARPETA, "kokoro-v1.0.onnx"), sess_options=opciones, providers=["CPUExecutionProvider"]
    )
    return Kokoro.from_session(sesion, os.path.join(CARPETA, "voices-v1.0.bin"))


registrar("Cargando el modelo de voz…")
MODELO = crear_modelo()
VOCES = sorted(MODELO.get_voices())
CERROJO = threading.Lock()  # el modelo atiende una frase a la vez; las demás esperan su turno
registrar("Calentando…")
MODELO.create("Listo.", voice=VOZ_POR_DEFECTO, speed=1.0, lang="es")
registrar(f"Voz lista en http://{HOST}:{PUERTO}/v1  ({len(VOCES)} voces; en español: ef_dora, em_alex, em_santa)")


def a_wav(muestras: np.ndarray, frecuencia: int) -> bytes:
    pcm = (np.clip(muestras, -1.0, 1.0) * 32767).astype(np.int16)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(frecuencia)
        w.writeframes(pcm.tobytes())
    return buffer.getvalue()


class Manejador(BaseHTTPRequestHandler):
    server_version = "OrbeVoz/1.0"

    def log_message(self, formato, *args):  # silencia el log por defecto de http.server
        pass

    def _responder(self, codigo: int, cuerpo: bytes, tipo: str) -> None:
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _error(self, codigo: int, mensaje: str) -> None:
        self._responder(codigo, json.dumps({"error": {"message": mensaje}}).encode(), "application/json")

    def do_GET(self):
        if self.path in ("/health", "/v1/health"):
            self._responder(200, json.dumps({"ok": True, "voces": VOCES}).encode(), "application/json")
        else:
            self._error(404, "No encontrado")

    def do_POST(self):
        if self.path.rstrip("/") not in ("/v1/audio/speech", "/audio/speech"):
            return self._error(404, "No encontrado")
        # Una página web no puede usar este servidor: los navegadores mandan «Origin» y no pueden pedir JSON sin permiso.
        if self.headers.get("Origin"):
            return self._error(403, "Origen no permitido")
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self._error(415, "Se esperaba JSON")
        try:
            largo = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._error(400, "Longitud no válida")
        if largo <= 0 or largo > MAX_CUERPO:
            return self._error(413, "Petición demasiado grande")
        try:
            datos = json.loads(self.rfile.read(largo))
        except ValueError:
            return self._error(400, "JSON no válido")

        texto = str(datos.get("input") or "").strip()
        voz = str(datos.get("voice") or VOZ_POR_DEFECTO)
        if not texto:
            return self._error(400, "Falta el texto (input)")
        if len(texto) > MAX_CARACTERES:
            return self._error(400, f"El texto supera {MAX_CARACTERES} caracteres")
        if voz not in VOCES:
            return self._error(400, f"Voz desconocida: {voz}")
        try:
            velocidad = min(1.5, max(0.5, float(datos.get("speed") or 1.0)))
        except (TypeError, ValueError):
            velocidad = 1.0

        inicio = time.time()
        try:
            with CERROJO:
                muestras, frecuencia = MODELO.create(texto, voice=voz, speed=velocidad, lang=IDIOMAS.get(voz[0], "en-us"))
        except Exception as error:  # noqa: BLE001
            registrar(f"Error al sintetizar: {error}")
            return self._error(500, "No se pudo sintetizar la voz")
        audio = a_wav(muestras, frecuencia)
        registrar(f"{voz}: {len(texto)} caracteres -> {len(muestras) / frecuencia:.1f} s de audio en {time.time() - inicio:.1f} s")
        self._responder(200, audio, "audio/wav")


if __name__ == "__main__":
    servidor = ThreadingHTTPServer((HOST, PUERTO), Manejador)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)

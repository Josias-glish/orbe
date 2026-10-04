@echo off
rem Arranca el servidor de voz de Orbe (Kokoro) en segundo plano, sin ventana. El registro queda en servidor.log.
rem Para pararlo: detener-voz.cmd
cd /d "%~dp0"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8880 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo El servidor de voz ya esta en marcha.
  exit /b 0
)
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath '%~dp0.venv\Scripts\python.exe' -ArgumentList 'servidor_voz.py' -WorkingDirectory '%~dp0' -RedirectStandardOutput '%~dp0servidor.log' -RedirectStandardError '%~dp0servidor-errores.log'"
echo Servidor de voz arrancando (tarda unos 15 segundos en cargar el modelo).

@echo off
rem Para el servidor de voz de Orbe: solo el proceso que escucha en el puerto 8880.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8880 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo Servidor de voz parado.

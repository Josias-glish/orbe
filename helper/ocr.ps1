# Reconoce el texto de una imagen con el OCR que trae Windows 10/11 (Windows.Media.Ocr), en el propio equipo.
# Lo lanza Orbe cuando el usuario pulsa «Texto de imagen»; no esta pensado para usarse a mano.
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ocr.ps1 -Ruta C:\ruta\imagen.png
# Escribe una sola linea JSON: {"ok":true,"texto":"...","idioma":"es-ES"} o {"ok":false,"error":"..."}.
# No envia nada a internet, no guarda nada y no toca la imagen.
param(
    [Parameter(Mandatory = $true)][string]$Ruta
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Responder($datos) {
    [Console]::Out.WriteLine(($datos | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

try {
    if (-not (Test-Path -LiteralPath $Ruta -PathType Leaf)) { throw "No encuentro la imagen." }
    $completa = (Resolve-Path -LiteralPath $Ruta).ProviderPath

    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

    # Las APIs de Windows son asincronas (IAsyncOperation<T>): se esperan como Task de .NET.
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Esperar($operacion, [Type]$tipo) {
        $tarea = $asTask.MakeGenericMethod($tipo).Invoke($null, @($operacion))
        if (-not $tarea.Wait(25000)) { throw "Windows ha tardado demasiado en leer la imagen." }
        $tarea.Result
    }

    $motor = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $motor) {
        $es = New-Object Windows.Globalization.Language 'es'
        if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($es)) { $motor = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($es) }
    }
    if ($null -eq $motor) {
        throw "Windows no tiene el reconocimiento de texto instalado para tus idiomas. Anade el paquete de idioma con 'Reconocimiento optico de caracteres' en Configuracion > Hora e idioma > Idioma y region."
    }

    $archivo = Esperar ([Windows.Storage.StorageFile]::GetFileFromPathAsync($completa)) ([Windows.Storage.StorageFile])
    $flujo = Esperar ($archivo.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decodificador = Esperar ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($flujo)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
        if ($decodificador.PixelWidth -gt $max -or $decodificador.PixelHeight -gt $max) {
            throw "La imagen es demasiado grande para el reconocimiento de Windows (maximo $max px por lado)."
        }
        $mapa = Esperar ($decodificador.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $resultado = Esperar ($motor.RecognizeAsync($mapa)) ([Windows.Media.Ocr.OcrResult])
    } finally {
        $flujo.Dispose()
    }

    $lineas = @($resultado.Lines | ForEach-Object { $_.Text })
    Responder @{ ok = $true; texto = ($lineas -join "`n"); idioma = $motor.RecognizerLanguage.LanguageTag }
    exit 0
} catch {
    $mensaje = $_.Exception.Message
    if ($_.Exception.InnerException) { $mensaje = $_.Exception.InnerException.Message }
    Responder @{ ok = $false; error = $mensaje }
    exit 2
}

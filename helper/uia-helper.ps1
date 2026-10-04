# Lanza el lector de pantalla de Orbe (UI Automation). Lo arranca Orbe, no esta pensado para usarse a mano.
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File uia-helper.ps1 -PidOrbe 1234 -CacheDir C:\ruta
# Compila UiaHelper.cs con el compilador de .NET Framework que ya trae Windows (no hace falta instalar nada).
# La primera vez tarda ~1-2 s; el resultado se guarda en CacheDir para que los arranques siguientes sean rapidos.
param(
    [int]$PidOrbe = 0,
    [string]$CacheDir = ''
)

$ErrorActionPreference = 'Stop'

function Fallar([string]$mensaje) {
    # Orbe lee esta linea para explicar por que no se puede leer la pantalla.
    $linea = (@{ tipo = 'error'; mensaje = $mensaje } | ConvertTo-Json -Compress)
    [Console]::Out.WriteLine($linea)
    [Console]::Out.Flush()
    exit 2
}

try {
    $aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
    $fuente = Join-Path $aqui 'UiaHelper.cs'
    $referencias = @('UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Web.Extensions')
    foreach ($r in $referencias) { Add-Type -AssemblyName $r }

    $dll = $null
    if ($CacheDir) {
        New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
        $hash = (Get-FileHash -Algorithm SHA256 -Path $fuente).Hash.Substring(0, 16)
        $dll = Join-Path $CacheDir "OrbeUia-$hash.dll"
    }

    if ($dll -and (Test-Path $dll)) {
        Add-Type -Path $dll
    } else {
        $codigo = [System.IO.File]::ReadAllText($fuente, [System.Text.Encoding]::UTF8)
        if ($dll) {
            Add-Type -TypeDefinition $codigo -ReferencedAssemblies $referencias -OutputAssembly $dll
            Add-Type -Path $dll
        } else {
            Add-Type -TypeDefinition $codigo -ReferencedAssemblies $referencias
        }
    }
} catch {
    Fallar("No se pudo preparar el lector de pantalla: $($_.Exception.Message)")
}

try {
    [Orbe.Servidor]::Ejecutar($PidOrbe)
} catch {
    Fallar("El lector de pantalla se detuvo: $($_.Exception.Message)")
}

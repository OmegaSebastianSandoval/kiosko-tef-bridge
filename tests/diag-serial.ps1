# Diagnostico del puerto serial del datafono (kiosko Windows).
# Uso:  powershell -ExecutionPolicy Bypass -File tests\diag-serial.ps1
# Opcional: -Port COM5   para probar otro puerto.

param([string]$Port = "COM3")

function Titulo($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

function Probar-Apertura($puerto) {
    $configs = @(
        @{ b = 9600;   d = 8; p = "None"; s = "One" },
        @{ b = 19200;  d = 8; p = "None"; s = "One" },
        @{ b = 115200; d = 8; p = "None"; s = "One" },
        @{ b = 9600;   d = 7; p = "Even"; s = "One" }
    )
    foreach ($c in $configs) {
        $etiqueta = "$($c.b) $($c.d)$($c.p)$($c.s)"
        try {
            $sp = New-Object System.IO.Ports.SerialPort $puerto, $c.b, $c.p, $c.d, $c.s
            $sp.Open()
            Write-Host "  OK    $etiqueta  -> ABRE" -ForegroundColor Green
            $sp.Close()
            $sp.Dispose()
        } catch {
            Write-Host "  FALLO $etiqueta  -> $($_.Exception.Message.Trim())" -ForegroundColor Red
            if ($sp) { $sp.Dispose() }
        }
    }
}

Titulo "Sistema"
(Get-CimInstance Win32_OperatingSystem).Caption
"Build: $([System.Environment]::OSVersion.Version)"

Titulo "Puertos registrados en SERIALCOMM"
$serialcomm = reg query HKLM\HARDWARE\DEVICEMAP\SERIALCOMM 2>&1
$serialcomm

Titulo "Dispositivo CH340"
$dev = Get-PnpDevice -Class Ports | Where-Object { $_.FriendlyName -like "*CH340*" }
if (-not $dev) {
    Write-Host "  No se encontro ningun CH340. Revisa el cable." -ForegroundColor Red
    exit 1
}
$dev | Select-Object Status, Problem, ProblemDescription, FriendlyName, InstanceId | Format-List

Titulo "Driver instalado"
Get-CimInstance Win32_PnPSignedDriver |
    Where-Object { $_.DeviceID -like "*VID_1A86*" } |
    Select-Object DeviceName, DriverVersion, DriverDate, InfName | Format-List

Titulo "Apertura ANTES de reinicializar ($Port)"
Probar-Apertura $Port

Titulo "Reinicializando el driver (disable + enable)"
try {
    Disable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false -ErrorAction Stop
    Write-Host "  deshabilitado" -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    Enable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false -ErrorAction Stop
    Write-Host "  habilitado" -ForegroundColor Yellow
    Start-Sleep -Seconds 4
} catch {
    Write-Host "  No se pudo reinicializar: $($_.Exception.Message.Trim())" -ForegroundColor Red
    Write-Host "  (ejecuta PowerShell como Administrador)" -ForegroundColor Yellow
}

Titulo "Estado tras reinicializar"
Get-PnpDevice -Class Ports | Where-Object { $_.FriendlyName -like "*CH340*" } |
    Select-Object Status, Problem, FriendlyName | Format-List

reg query HKLM\HARDWARE\DEVICEMAP\SERIALCOMM 2>&1

Titulo "Apertura DESPUES de reinicializar ($Port)"
Probar-Apertura $Port

Titulo "Otros drivers ch341 disponibles en el almacen"
pnputil /enum-drivers | Select-String -Pattern "ch341" -Context 4,4

Write-Host "`n--- fin del diagnostico ---`n" -ForegroundColor Cyan

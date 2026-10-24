# Loop Tuner's external plant (Live mode): installs what it needs, then runs.
# Windows: right-click > Run with PowerShell, or in a terminal:
#   powershell -ExecutionPolicy Bypass -File runme.ps1      (options go to hil_plant.py: ... runme.ps1 --help)
# It installs uv (https://docs.astral.sh/uv/) with winget, or with uv's own
# installer where there is no winget; uv then fetches Python and the
# websockets package for hil_plant.py. Run it again any time; what is
# installed stays.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing uv, the Python runner (https://docs.astral.sh/uv/) ...'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id=astral-sh.uv -e --accept-source-agreements --accept-package-agreements
  } else {
    powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://astral.sh/uv/install.ps1 | iex'
  }
  # The installer changed PATH for new windows; read it back for this one.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ";$env:USERPROFILE\.local\bin"
}
uv run hil_plant.py @args
if ($LASTEXITCODE) { Read-Host 'hil_plant.py stopped with an error; press Enter to close' }

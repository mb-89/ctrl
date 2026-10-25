# Loop Tuner's external plant (Live mode): installs what it needs, then runs.
# Windows: double-click runme.cmd (it runs this script), or right-click
# runme.ps1 > Run with PowerShell, or in a terminal:
#   powershell -ExecutionPolicy Bypass -File runme.ps1      (options go to hil_plant.py: ... runme.ps1 --help)
# It installs uv (https://docs.astral.sh/uv/) with winget, or with uv's own
# installer where there is no winget; uv then fetches a Python of its own
# (with tkinter, for the plant's window) and what hil_plant.py needs
# (websockets, and mini-racer: V8, which runs the page's code in
# loop-tuner-core.js). Run it again any time; what is installed stays.
$ErrorActionPreference = 'Stop'
# A window opened by a click closes when the script ends: on any error, say
# what went wrong and wait for Enter (runme.cmd waits by itself).
function Stop-WithMessage([string]$text) {
  Write-Host $text -ForegroundColor Red
  if ($env:RUNME_FROM_CMD -ne '1') { Read-Host 'Press Enter to close' | Out-Null }
  exit 1
}
try {
  Set-Location $PSScriptRoot
  # --help installs nothing: the plant's options, from whatever Python is here.
  if ($args -contains '--help' -or $args -contains '-h') {
    Write-Host 'runme [options]: installs uv if it is missing, then starts the plant (hil_plant.py) with these options;'
    Write-Host 'with none, the default model with its physics varied by up to 15 %.'
    Write-Host ''
    if (Get-Command python -ErrorAction SilentlyContinue) { python hil_plant.py --help }
    elseif (Get-Command uv -ErrorAction SilentlyContinue) { uv run --python-preference only-managed hil_plant.py --help }
    else { Write-Host '(Python is not installed yet: run runme once, or read README.md, for the options.)' }
    if ($env:RUNME_FROM_CMD -ne '1') { Read-Host 'Press Enter to close' | Out-Null }
    exit 0
  }
  $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing uv, the Python runner (https://docs.astral.sh/uv/) ...'
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      winget install --id=astral-sh.uv -e --source winget --accept-source-agreements --accept-package-agreements
    } else {
      powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://astral.sh/uv/install.ps1 | iex'
    }
    # The installer changed PATH for new windows; read it back for this one.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ";$env:USERPROFILE\.local\bin"
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
      Stop-WithMessage 'Could not install uv. Install it by hand (https://docs.astral.sh/uv/getting-started/installation/), then run runme again.'
    }
  }
  uv run --python-preference only-managed hil_plant.py @args
  if ($LASTEXITCODE) { Stop-WithMessage "hil_plant.py stopped with an error (exit code $LASTEXITCODE)." }
} catch {
  Stop-WithMessage "runme.ps1 failed: $($_.Exception.Message)"
}

# Loop Tuner's MCP server: installs Node.js if it is missing, then starts it.
# Windows: double-click runme.cmd (it runs this script), or right-click
# runme.ps1 > Run with PowerShell, or in a terminal:
#   powershell -ExecutionPolicy Bypass -File runme.ps1      (options go to mcp.mjs)
# Node.js comes from winget (OpenJS.NodeJS.LTS). Started here, the server
# serves the page and prints how to register it with your agent's client.
$ErrorActionPreference = 'Stop'
function Stop-WithMessage([string]$text) {
  Write-Host $text -ForegroundColor Red
  if ($env:RUNME_FROM_CMD -ne '1') { Read-Host 'Press Enter to close' | Out-Null }
  exit 1
}
function Test-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
  return ($LASTEXITCODE -eq 0)
}
try {
  Set-Location $PSScriptRoot
  if (-not (Test-Node)) {
    Write-Host "Loop Tuner's MCP server needs Node.js 18 or later; installing it with winget ..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Stop-WithMessage 'winget is not here: install Node.js 18 or later from https://nodejs.org, then run runme again.'
    }
    winget install --id=OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
    # The installer changed PATH for new windows; read it back for this one.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Test-Node)) { Stop-WithMessage 'Could not install Node.js. Install it from https://nodejs.org, then run runme again.' }
  }
  node mcp.mjs @args
  if ($LASTEXITCODE) { Stop-WithMessage "mcp.mjs stopped with an error (exit code $LASTEXITCODE)." }
} catch {
  Stop-WithMessage "runme.ps1 failed: $($_.Exception.Message)"
}

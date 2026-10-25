# Loop Tuner (Windows): installs what it needs, builds the page and opens it.
# Right-click runme.ps1 > Run with PowerShell, or in a terminal:
#   powershell -ExecutionPolicy Bypass -File runme.ps1 [command]
# No command is needed; every command: runme.ps1 --help (it installs nothing).
# Node.js 18 or later comes from winget (OpenJS.NodeJS.LTS), and uv (the
# Python runner the external plant uses) from winget (astral-sh.uv) or uv's
# own installer. Run it again any time; what is installed stays.
$ErrorActionPreference = 'Stop'
function Stop-WithMessage([string]$text) {
  Write-Host $text -ForegroundColor Red
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}
function Show-Usage {
  Write-Host @'
runme.ps1 [command]: installs what Loop Tuner needs, then

  (none)       builds the page and opens it in the browser
  build        builds the page: dist\loop-tuner.html (and dist\artifact.html, dist\hil-plant\)
  open         opens the built page in the browser
  test         runs the tests (npm test); test-slow runs the slow ones
  mcp [opts]   starts the MCP server (mcp\runme.ps1: it serves the page and explains how to connect an agent)
  plant [opts] starts the external plant for Live mode (the built dist\hil-plant\runme.ps1; --help lists its options)
  cli [args]   the command line for agents and scripts (tools\cli.mjs; cli --help lists it)

README.md says what each part is.
'@
}
function Read-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.local\bin" }
function Test-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
  return ($LASTEXITCODE -eq 0)
}
function Use-Node {
  if (Test-Node) { return }
  Write-Host 'Loop Tuner needs Node.js 18 or later; installing it with winget ...'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Stop-WithMessage 'winget is not here: install Node.js 18 or later from https://nodejs.org, then run runme again.' }
  winget install --id=OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
  Read-Path
  if (-not (Test-Node)) { Stop-WithMessage 'Could not install Node.js. Install it from https://nodejs.org, then run runme again.' }
}
# uv only matters for the external plant: a failure here is said, not fatal.
function Use-Uv {
  if (Get-Command uv -ErrorAction SilentlyContinue) { return }
  Write-Host 'Installing uv, the Python runner the external plant uses (https://docs.astral.sh/uv/) ...'
  try {
    if (Get-Command winget -ErrorAction SilentlyContinue) { winget install --id=astral-sh.uv -e --source winget --accept-source-agreements --accept-package-agreements }
    else { powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://astral.sh/uv/install.ps1 | iex' }
  } catch { }
  Read-Path
  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { Write-Host "(uv is not installed: the page works without it; 'runme plant' installs it when you need the external plant.)" }
}
function Build-Page {
  node tools/build.mjs
  if ($LASTEXITCODE) { Stop-WithMessage "The build stopped with an error (exit code $LASTEXITCODE)." }
}
function Open-Page {
  $page = Join-Path $PSScriptRoot 'dist\loop-tuner.html'
  Start-Process $page
  Write-Host "Opened $page"
}

try {
  Set-Location $PSScriptRoot
  $cmd = if ($args.Count) { $args[0] } else { '' }
  if ($cmd -in '--help', '-h', 'help') { Show-Usage; exit 0 }
  $rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }
  switch ($cmd) {
    { $_ -in '', 'start' } { Use-Node; Use-Uv; Build-Page; Open-Page }
    'build' { Use-Node; Build-Page }
    'open' { if (-not (Test-Path 'dist\loop-tuner.html')) { Use-Node; Build-Page }; Open-Page }
    'test' { Use-Node; node --test (Get-ChildItem test\*.test.mjs | ForEach-Object { $_.FullName }) }
    'test-slow' { Use-Node; node --test test\planner.slow.mjs }
    'mcp' { & (Join-Path $PSScriptRoot 'mcp\runme.ps1') @rest }
    'plant' { if (-not (Test-Path 'dist\hil-plant\loop-tuner-core.js')) { Use-Node; Build-Page }; & (Join-Path $PSScriptRoot 'dist\hil-plant\runme.ps1') @rest }
    'cli' { Use-Node; node tools/cli.mjs @rest }
    default { Write-Host "Unknown command: $cmd"; Write-Host ''; Show-Usage; exit 1 }
  }
} catch {
  Stop-WithMessage "runme.ps1 failed: $($_.Exception.Message)"
}

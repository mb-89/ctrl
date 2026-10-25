@echo off
rem Loop Tuner's MCP server, for Windows: double-click this file.
rem It runs runme.ps1 with PowerShell, which installs Node.js if it is missing
rem (with winget) and starts mcp.mjs; options go to mcp.mjs: runme.cmd --port 8766
setlocal
set RUNME_FROM_CMD=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runme.ps1" %*
if errorlevel 1 pause

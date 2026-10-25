@echo off
rem Loop Tuner's external plant (Live mode), for Windows: double-click this file.
rem It runs runme.ps1 with PowerShell, which installs what it needs (uv) and
rem starts hil_plant.py; options go to hil_plant.py: runme.cmd --help
setlocal
set RUNME_FROM_CMD=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runme.ps1" %*
if errorlevel 1 pause

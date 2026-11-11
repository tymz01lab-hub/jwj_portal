@echo off
cd /d "%~dp0"
node portal-server.cjs --open
if errorlevel 1 pause

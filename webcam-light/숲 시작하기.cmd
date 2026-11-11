@echo off
setlocal
set "forest_chrome=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%forest_chrome%" set "forest_chrome=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%forest_chrome%" set "forest_chrome=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%forest_chrome%" (
  echo Chrome could not be found. Open index.html in Chrome.
  pause
  exit /b 1
)
start "" "%forest_chrome%" "%~dp0index.html"
endlocal

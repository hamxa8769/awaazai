@echo off
REM AwaazAI start script — Windows
REM Server start kare, ready hone ka wait kare, browser mein page khole.
REM Pehli dafa: .venv banaye + requirements install kare (sirf pehli dafa).
REM Chalana: start.bat par double-click karein, ya cmd mein: start.bat
REM Doosra port: start.bat --port 8001
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Error: python nahi mila. Pehle Python 3.11+ install karein (python.org se),
  echo aur install karte waqt "Add Python to PATH" par tick lagayein.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Pehli dafa setup ho raha hai: virtual environment bana rahi hoon...
  python -m venv .venv
  if errorlevel 1 (
    echo Error: virtual environment nahi bana. Python install check karein.
    pause
    exit /b 1
  )
  echo Dependencies install ho rahi hain (requirements.txt)...
  .venv\Scripts\pip install -r requirements.txt
  if errorlevel 1 (
    echo Error: dependencies install nahi hui. Internet / pip check karein.
    pause
    exit /b 1
  )
)

.venv\Scripts\python -u start.py %*
if errorlevel 1 (
  echo.
  echo AwaazAI band ho gaya (error upar dekhein).
  pause
)
endlocal

@echo off
REM AwaazAI start script — Windows
REM Server start kare, ready hone ka wait kare, browser mein page khole.
REM Pehli dafa: .venv banaye + requirements install kare (sirf pehli dafa).
REM Chalana: start.bat par double-click karein, ya cmd mein: start.bat
REM Doosra port: start.bat --port 8001
REM
REM v0.4.1 fix — Python dhoondhne ka tareeqa robust banaya gaya:
REM   Pehle .venv check hoti hai (agar .venv hai to system Python ki
REM   zaroorat hi nahi). Phir, is order mein: `where python`,
REM   `python --version` (App Execution Alias / App Paths se bhi mil
REM   jata hai jab `where` fail ho), `where py` / `py --version`
REM   (Python launcher), phir common install locations
REM   (%LOCALAPPDATA%\Programs\Python\Python3*,
REM   %ProgramFiles%\Python3*, C:\Python3*).
REM   Microsoft Store stub (%LOCALAPPDATA%\Microsoft\WindowsApps) ko
REM   jaan boojh kar use NAHI kiya — wo asal Python nahi, Store kholta hai.
REM   Agar kuch na mile to diagnostics (where/py/python --version) print
REM   hote hain taake agla error guess na karna pare.
setlocal
cd /d "%~dp0"

REM 1. .venv pehle — agar ye hai to system Python PATH mein ho ya na ho,
REM    koi farq nahi parta, seedha .venv wala Python use hoga.
if exist ".venv\Scripts\python.exe" goto :run

REM 2. System Python dhoondho (sirf .venv banane ke liye chahiye).
set "PY="

REM 2a. `where python` — aam tareeqa.
where python >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY goto :found_python

REM 2b. `python --version` — `where` kabhi kabhi fail ho jata hai jab
REM     Python App Execution Alias / App Paths se milta hai (PowerShell
REM     mein `python --version` chalta hai, cmd mein `where python`
REM     phir bhi nahi milta — yehi v0.4.0 wala bug tha).
python --version >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY goto :found_python

REM 2c. Python launcher `py` — python.org installer ye hamesha deta hai,
REM     chahe "Add Python to PATH" par tick na lagi ho.
where py >nul 2>nul
if not errorlevel 1 goto :found_py
py --version >nul 2>nul
if not errorlevel 1 goto :found_py

REM 2d. Common install locations — PATH mein na ho to bhi mil jaye.
REM     for /d loop mein aakhri milne wala jeetta hai, is liye folders
REM     chhote version se bare version ki taraf likhe hain (Python314
REM     aakhri mein aayega to wahi use hoga).
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY=%%D\python.exe"
if defined PY goto :found_python
for /d %%D in ("%USERPROFILE%\AppData\Local\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY=%%D\python.exe"
if defined PY goto :found_python
for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\python.exe" set "PY=%%D\python.exe"
if defined PY goto :found_python
for /d %%D in ("C:\Python3*") do if exist "%%D\python.exe" set "PY=%%D\python.exe"
if defined PY goto :found_python

goto :no_python

:found_py
echo Python launcher (py) mila, us se .venv bana rahi hoon...
py -3 -m venv .venv
if errorlevel 1 goto :venv_failed
goto :install

:found_python
echo Python mila: %PY%
"%PY%" -m venv .venv
if errorlevel 1 goto :venv_failed
goto :install

:install
echo Dependencies install ho rahi hain (requirements.txt)...
.venv\Scripts\pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Error: dependencies install nahi hui. Internet / pip check karein.
  echo Note: AwaazAI Python 3.12 par test hua hai.
  echo Python 3.14 par kuch packages install na hon to Python 3.12
  echo install karein (python.org se) aur dobara start.bat chalaye.
  pause
  exit /b 1
)
goto :run

:venv_failed
echo.
echo Error: virtual environment nahi bana. Python install check karein.
pause
exit /b 1

:no_python
echo.
echo Error: python nahi mila.
echo Maine ye jagah check ki:
echo   - where python / python --version
echo   - where py / py --version (Python launcher)
echo   - %LOCALAPPDATA%\Programs\Python\Python3*\python.exe
echo   - %USERPROFILE%\AppData\Local\Programs\Python\Python3*\python.exe
echo   - %ProgramFiles%\Python3*\python.exe
echo   - C:\Python3*\python.exe
echo.
echo Diagnostics (ye output agla error samajhne mein madad karega):
where python
where py
py --version
python --version
echo.
echo Hal:
echo   1. Python 3.12 install karein (python.org se), install karte waqt
echo      "Add Python to PATH" par tick lagayein, phir PowerShell band
echo      karke dobara kholein aur start.bat chalaye.
echo   2. Ya foran ka hal (PowerShell mein, is folder se):
echo      py -m venv .venv
echo      .\.venv\Scripts\pip install -r requirements.txt
echo      .\.venv\Scripts\python -u start.py
pause
exit /b 1

:run
.venv\Scripts\python -u start.py %*
if errorlevel 1 (
  echo.
  echo AwaazAI band ho gaya (error upar dekhein).
  pause
)
endlocal

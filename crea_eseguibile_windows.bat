@echo off
REM ===========================================================================
REM Crea AtomoCeleste.exe per Windows 11, con l'icona e il collegamento sul
REM Desktop.                                   (c) 2026 Edoardo Battistel
REM
REM Prima serve Python per la sola compilazione: scaricalo da python.org e
REM durante l'installazione spunta "Add python.exe to PATH".
REM Uso: doppio clic su crea_eseguibile_windows.bat (nella cartella della 1.5)
REM ===========================================================================
chcp 65001 >nul
cd /d "%~dp0"

if not exist dati_atomo.py goto mancante
if not exist atomo_celeste.ico goto mancante
if not exist web\index.html goto mancante
if not exist web\app.js goto mancante
if not exist atomo_celeste.py goto mancante

where py >nul 2>nul
if %errorlevel%==0 (set PY=py -3) else (set PY=python)
%PY% --version >nul 2>nul
if errorlevel 1 (
    echo ERRORE: Python non trovato. Installalo da https://www.python.org
    echo spuntando "Add python.exe to PATH", poi riavvia questo file.
    pause
    exit /b 1
)

echo === 1/3  Ambiente Python temporaneo per la compilazione ===
if not exist .venv-build (%PY% -m venv .venv-build || goto errore)
call .venv-build\Scripts\activate.bat
python -m pip install --upgrade pip || goto errore
python -m pip install numpy pillow pyinstaller || goto errore

echo === 2/3  Creazione dell'eseguibile ===
pyinstaller --noconfirm --clean --onefile --console ^
    --name AtomoCeleste ^
    --icon atomo_celeste.ico ^
    --add-data "web;web" ^
    --hidden-import dati_atomo ^
    --hidden-import PIL.Image ^
    --hidden-import numpy ^
    --exclude-module astropy ^
    --exclude-module matplotlib ^
    --exclude-module scipy ^
    --exclude-module tkinter ^
    atomo_celeste.py || goto errore
call deactivate

echo === Verifica dell'eseguibile (autotest) ===
dist\AtomoCeleste.exe --autotest > autotest.txt 2>&1
type autotest.txt
findstr /c:"AUTOTEST SUPERATO" autotest.txt >nul || (
    echo.
    echo L'autotest e' FALLITO: i dettagli sono in %cd%\autotest.txt
    goto errore
)

echo === 3/3  Collegamento sul Desktop ===
copy /y dist\AtomoCeleste.exe "%cd%\AtomoCeleste.exe" >nul
powershell -NoProfile -Command ^
  "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut(\"$d\Atomo Celeste.lnk\"); $s.TargetPath='%cd%\AtomoCeleste.exe'; $s.WorkingDirectory='%cd%'; $s.IconLocation='%cd%\AtomoCeleste.exe,0'; $s.Save()"

rmdir /s /q .venv-build build 2>nul
del /q AtomoCeleste.spec 2>nul

echo.
echo FATTO.
echo   Eseguibile: %cd%\AtomoCeleste.exe
echo   Sul Desktop trovi il collegamento "Atomo Celeste".
pause
exit /b 0

:mancante
echo ERRORE: atomo_celeste.py, dati_atomo.py, atomo_celeste.ico e la cartella web devono essere qui.
pause
exit /b 1

:errore
echo.
echo Si e' verificato un errore: copia i messaggi qui sopra e inviameli.
pause
exit /b 1

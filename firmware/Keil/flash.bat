@echo off
set "OPENOCD=C:\Program Files (x86)\Nuvoton Tools\OpenOCD\bin\openocd.exe"
set "SCRIPTS=C:\Program Files (x86)\Nuvoton Tools\OpenOCD\scripts"
set "HEX_FILE=build/Template/Template.hex"

echo.
echo ========================================
echo   SWATHI SWITCHGEAR FLASH UTILITY
echo ========================================
echo [INFO] Hex File: %HEX_FILE%
echo [INFO] Initializing OpenOCD...
timeout /t 1 > nul

echo --- Starting Flash Process ---
"%OPENOCD%" -s "%SCRIPTS%" -f interface/nulink.cfg -f target/numicroM0.cfg -c "program {%HEX_FILE%} verify reset exit"
if %errorlevel% neq 0 (
    echo [ERROR] Flash failed!
    pause
    exit /b %errorlevel%
)
echo.
echo [SUCCESS] Flash complete!
pause

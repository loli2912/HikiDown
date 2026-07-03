@echo off
title HikiDown setup
echo === HikiDown setup ===
echo.
echo [1/2] Installing / updating yt-dlp...
py -3 -m pip install --upgrade yt-dlp
if errorlevel 1 python -m pip install --upgrade yt-dlp
echo.
echo [2/2] Checking ffmpeg (needed for 1080p and above)...
where ffmpeg >nul 2>nul
if errorlevel 1 (
    echo ffmpeg not found - installing via winget...
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
) else (
    echo ffmpeg already installed.
)
echo.
echo Setup finished. Now run start-server.bat and load the extension folder in Chrome.
pause

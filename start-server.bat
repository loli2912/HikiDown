@echo off
title HikiDown server
cd /d "%~dp0server"
py -3 server.py
if errorlevel 1 python server.py
pause

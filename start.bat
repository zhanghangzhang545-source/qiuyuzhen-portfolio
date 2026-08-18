@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set PORT=8080
echo 正在启动 QIU YUZHEN 艺术作品集（端口 !PORT!）...

where python >nul 2>nul
if %errorlevel%==0 (
  start /min python -m http.server !PORT!
  timeout /t 1 >nul
  start "" http://localhost:!PORT!/
  goto :eof
)

where python3 >nul 2>nul
if %errorlevel%==0 (
  start /min python3 -m http.server !PORT!
  timeout /t 1 >nul
  start "" http://localhost:!PORT!/
  goto :eof
)

where node >nul 2>nul
if %errorlevel%==0 (
  set PORT=5173
  start /min cmd /c "set PORT=5173&& node serve.mjs"
  timeout /t 1 >nul
  start "" http://localhost:!PORT!/
  goto :eof
)

echo 未检测到 Python 或 Node。请先安装其中之一后重试：
echo   Python: https://www.python.org/downloads/   （安装时务必勾选 "Add Python to PATH"）
echo   Node:   https://nodejs.org/
pause

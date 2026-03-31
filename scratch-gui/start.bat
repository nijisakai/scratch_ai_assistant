@echo off
title Scratch AI Assistant
echo 正在启动 AI 微服务...
cd /d "%~dp0.."
start /B python app.py
echo 正在启动 GUI...
cd /d "%~dp0"
start "" "%~dp0dist-electron\Scratch AI Assistant-win32-x64\Scratch AI Assistant.exe"

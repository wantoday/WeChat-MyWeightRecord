@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 启动 WeightRecord 本地数据服务...
echo 保持本窗口开启即可。关闭窗口 = 停止服务。
echo.
node server.js
echo.
echo 服务已退出。按任意键关闭窗口。
pause >nul

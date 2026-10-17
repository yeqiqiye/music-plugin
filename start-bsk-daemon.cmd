@echo off
rem 这个窗口必须一直开着：bsk daemon 需要一个独立宿主进程。
rem 开了它之后，DSH 里的 BrowserSkill 工具就能驱动 Edge。
set BSK_HOME=%USERPROFILE%\.bsk
"D:\tools\bsk\bsk.exe" daemon start --foreground
pause
@echo off
"C:\Users\LENOVO\AppData\Roaming\npm\node_modules\yt-dlp-exec\dist\yt-dlp.exe" %* 2>&1 | findstr /V "Deprecated Feature" | findstr /V "^$"

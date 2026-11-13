RUSH POS PRO - DESKTOP (.exe) KIT
=================================
Engine: Electron (Chromium) - same as Chrome, so Web Serial, localStorage, Firebase all work.

BUILD THE .EXE (Windows PC, one time)
 1. Install Node.js LTS  (https://nodejs.org)
 2. Double-click  build-exe.bat
 3. Take the installer / portable .exe from the  dist  folder.
 (No Node? Upload this folder to GitHub -> Actions -> "Build Rush POS exe" -> download artifact.)

TEST WITHOUT BUILDING:   npm install  then  npm start

PRINTING (Settings > Desktop Printing, inside the app)
 - Windows printer (silent): picks any installed printer, no dialog.
 - Network printer: ESC/POS over LAN, IP:9100 (use "Scan LAN").  Auto cut + cash drawer.
 - USB printer via Windows share: share the printer, type the share name. Raw ESC/POS.
 - Browser dialog: normal print dialog.
Keys: F11 fullscreen, F5 reload, F12 devtools.
Optional: put icon.ico in build\ folder for a custom icon.
Note: first launch needs internet for Google Fonts / Firebase; billing works offline after that.

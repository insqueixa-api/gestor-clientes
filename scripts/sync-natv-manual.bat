@echo off
REM Sync manual do catalogo NaTV — de clique duplo, sem precisar saber o que
REM "node" e. So chama scripts/sync-natv-manual.js (que faz o trabalho de
REM verdade) e deixa a janela aberta no final pra dar pra ler o resultado.
cd /d "%~dp0.."
node scripts\sync-natv-manual.js
echo.
pause

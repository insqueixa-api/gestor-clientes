const fs = require('fs');
let c = fs.readFileSync('app/admin/evolucao-client.tsx', 'utf8');

c = c.replace(/const BG = isDark \? "#18212f" : "#ffffff";/, 'const BG = "transparent";');
c = c.replace(/const GRID = isDark \? "rgba\(255,255,255,0\.06\)" : "rgba\(0,0,0,0\.06\)";/, 'const GRID = "rgba(255,255,255,0.06)";');
c = c.replace(/const TICK = isDark \? "rgba\(148,163,184,0\.65\)" : "rgba\(71,85,105,0\.65\)";/, 'const TICK = "rgba(255,255,255,0.5)";');

fs.writeFileSync('app/admin/evolucao-client.tsx', c, 'utf8');
console.log('Fixed constants');

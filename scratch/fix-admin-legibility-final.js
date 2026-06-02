const fs = require('fs');

let evolucao = fs.readFileSync('app/admin/evolucao-client.tsx', 'utf8');

// Replace labelColor and valColor logic completely to ignore isDark
// because BOTH light and dark themes are actually dark now!
const replaceRegex = /const labelColor = row\.bold \? \(isDark \? "#f8fafc" : "#0f172a"\) : TICK;\n\s*const valColor = \(val: number\) => {\n\s*if \(val === 0\) return isDark \? "rgba\(255,255,255,0\.15\)" : "rgba\(0,0,0,0\.15\)";\n\s*\/\/ Using a clear, readable color for all numbers instead of applying red\/green to text!\n\s*return isDark \? "#e2e8f0" : "#334155";\n\s*};/m;

const replacement = `const labelColor = row.bold ? "#f8fafc" : "rgba(255,255,255,0.7)";
  const valColor = (val: number) => {
    if (val === 0) return "rgba(255,255,255,0.15)";
    // Since both light and dark themes are now dark backgrounds, we MUST use light text
    return "#e2e8f0";
  };`;

evolucao = evolucao.replace(replaceRegex, replacement);

fs.writeFileSync('app/admin/evolucao-client.tsx', evolucao, 'utf8');
console.log('Fixed Evolucao legibility for real this time');

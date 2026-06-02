const fs = require('fs');

let evolucao = fs.readFileSync('app/admin/evolucao-client.tsx', 'utf8');

// The original lines are completely replaced to ensure perfect legibility.
// In the chart lines, we return them to the more vibrant #10b981 and #f43f5e colors
// so they stand out properly against the dark background.
evolucao = evolucao.replace(/const L1 = .*/, 'const L1 = isDark ? "#10b981" : "#10b981";');
evolucao = evolucao.replace(/const L2 = .*/, 'const L2 = isDark ? "#f43f5e" : "#e11d48";');

// Replace the valColor logic entirely.
const replaceRegex = /const labelColor = row\.bold[\s\S]*?: TICK;/m;
const replacement = `const labelColor = row.bold ? (isDark ? "#f8fafc" : "#0f172a") : TICK;
  const valColor = (val: number) => {
    if (val === 0) return isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
    // Using a clear, readable color for all numbers instead of applying red/green to text!
    return isDark ? "#e2e8f0" : "#334155";
  };`;

evolucao = evolucao.replace(replaceRegex, replacement);

fs.writeFileSync('app/admin/evolucao-client.tsx', evolucao, 'utf8');
console.log('Fixed Evolucao legibility');

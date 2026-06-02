const fs = require('fs');

let ranking = fs.readFileSync('app/admin/ranking-card.tsx', 'utf8');

// Replace solid gradients with soft, translucent RGBA gradients to match the system's "20%" opacity theme.
ranking = ranking.replace(/linear-gradient\(to right,#0284c7,#0ea5e9\)/g, 'linear-gradient(to right,rgba(14,165,233,0.15),rgba(14,165,233,0.4))'); // Sky
ranking = ranking.replace(/linear-gradient\(to right,#059669,#10b981\)/g, 'linear-gradient(to right,rgba(16,185,129,0.15),rgba(16,185,129,0.4))'); // Emerald
ranking = ranking.replace(/linear-gradient\(to right,#7c3aed,#8b5cf6\)/g, 'linear-gradient(to right,rgba(139,92,246,0.15),rgba(139,92,246,0.4))'); // Violet
ranking = ranking.replace(/linear-gradient\(to right,#e11d48,#f43f5e\)/g, 'linear-gradient(to right,rgba(244,63,94,0.15),rgba(244,63,94,0.4))'); // Rose
ranking = ranking.replace(/linear-gradient\(to right,#d97706,#f59e0b\)/g, 'linear-gradient(to right,rgba(245,158,11,0.15),rgba(245,158,11,0.4))'); // Amber
ranking = ranking.replace(/linear-gradient\(to right,#4f46e5,#6366f1\)/g, 'linear-gradient(to right,rgba(99,102,241,0.15),rgba(99,102,241,0.4))'); // Indigo

// Top bars (if they exist)
ranking = ranking.replace(/linear-gradient\(to right,#0369a1,#0ea5e9,#38bdf8\)/g, 'linear-gradient(to right,rgba(14,165,233,0.3),rgba(14,165,233,0.5))');
ranking = ranking.replace(/linear-gradient\(to right,#065f46,#059669,#34d399\)/g, 'linear-gradient(to right,rgba(16,185,129,0.3),rgba(16,185,129,0.5))');
ranking = ranking.replace(/linear-gradient\(to right,#4c1d95,#7c3aed,#a78bfa\)/g, 'linear-gradient(to right,rgba(139,92,246,0.3),rgba(139,92,246,0.5))');
ranking = ranking.replace(/linear-gradient\(to right,#881337,#e11d48,#fb7185\)/g, 'linear-gradient(to right,rgba(244,63,94,0.3),rgba(244,63,94,0.5))');
ranking = ranking.replace(/linear-gradient\(to right,#b45309,#d97706,#fbbf24\)/g, 'linear-gradient(to right,rgba(245,158,11,0.3),rgba(245,158,11,0.5))');
ranking = ranking.replace(/linear-gradient\(to right,#3730a3,#4f46e5,#818cf8\)/g, 'linear-gradient(to right,rgba(99,102,241,0.3),rgba(99,102,241,0.5))');

fs.writeFileSync('app/admin/ranking-card.tsx', ranking, 'utf8');
console.log('Softened RankingCard');

// 2. Evolucao Client
let evolucao = fs.readFileSync('app/admin/evolucao-client.tsx', 'utf8');

// Make the strokes slightly translucent and the table texts translucent to match the theme
evolucao = evolucao.replace(/const L1 = isDark \? "#10b981" : "#10b981";/, 'const L1 = isDark ? "rgba(16,185,129,0.5)" : "#10b981";');
evolucao = evolucao.replace(/const L2 = isDark \? "#f43f5e" : "#e11d48";/, 'const L2 = isDark ? "rgba(244,63,94,0.5)" : "#e11d48";');

evolucao = evolucao.replace(/darkColor: "#22c55e"/g, 'darkColor: "rgba(16,185,129,0.6)"');
evolucao = evolucao.replace(/darkColor: "#10b981"/g, 'darkColor: "rgba(16,185,129,0.6)"');

evolucao = evolucao.replace(/darkColor: "#ef4444"/g, 'darkColor: "rgba(244,63,94,0.6)"');
evolucao = evolucao.replace(/darkColor: "#f43f5e"/g, 'darkColor: "rgba(244,63,94,0.6)"');

// Make line dots match
evolucao = evolucao.replace(/dot: "#22c55e"/g, 'dot: "rgba(16,185,129,0.5)"');
evolucao = evolucao.replace(/dot: "#16a34a"/g, 'dot: "rgba(16,185,129,0.5)"');
evolucao = evolucao.replace(/dot: "#ef4444"/g, 'dot: "rgba(244,63,94,0.5)"');
evolucao = evolucao.replace(/dot: "#dc2626"/g, 'dot: "rgba(244,63,94,0.5)"');

fs.writeFileSync('app/admin/evolucao-client.tsx', evolucao, 'utf8');
console.log('Softened Evolucao');


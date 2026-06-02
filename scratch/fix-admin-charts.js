const fs = require('fs');

// 1. Fix Evolução Consolidada (Line Chart)
let evolucao = fs.readFileSync('app/admin/evolucao-client.tsx', 'utf8');

// Replace neon green (emerald-400: #34d399, green-400: #4ade80, green-300: #86efac)
// with sober green (emerald-500: #10b981, green-500: #22c55e, green-500: #22c55e)
evolucao = evolucao.replace(/"#34d399"/g, '"#10b981"');
evolucao = evolucao.replace(/"#4ade80"/g, '"#22c55e"');
evolucao = evolucao.replace(/"#86efac"/g, '"#22c55e"');

// Replace neon red (rose-400: #fb7185, red-400: #f87171, red-300: #fca5a5)
// with sober red (rose-500: #f43f5e, red-500: #ef4444, red-500: #ef4444)
evolucao = evolucao.replace(/"#fb7185"/g, '"#f43f5e"');
evolucao = evolucao.replace(/"#f87171"/g, '"#ef4444"');
evolucao = evolucao.replace(/"#fca5a5"/g, '"#ef4444"');

fs.writeFileSync('app/admin/evolucao-client.tsx', evolucao, 'utf8');
console.log('Fixed evolucao-client.tsx');

// 2. Fix RankingCard (Bar Charts)
let ranking = fs.readFileSync('app/admin/ranking-card.tsx', 'utf8');

// Sky: #38bdf8 (400) -> #0ea5e9 (500)
ranking = ranking.replace(/linear-gradient\(to right,#0284c7,#38bdf8\)/g, 'linear-gradient(to right,#0284c7,#0ea5e9)');
// Emerald: #34d399 (400) -> #10b981 (500)
ranking = ranking.replace(/linear-gradient\(to right,#059669,#34d399\)/g, 'linear-gradient(to right,#059669,#10b981)');
// Violet: #a78bfa (400) -> #8b5cf6 (500)
ranking = ranking.replace(/linear-gradient\(to right,#7c3aed,#a78bfa\)/g, 'linear-gradient(to right,#7c3aed,#8b5cf6)');
// Rose: #fb7185 (400) -> #f43f5e (500)
ranking = ranking.replace(/linear-gradient\(to right,#e11d48,#fb7185\)/g, 'linear-gradient(to right,#e11d48,#f43f5e)');
// Amber: #fbbf24 (400) -> #f59e0b (500)
ranking = ranking.replace(/linear-gradient\(to right,#d97706,#fbbf24\)/g, 'linear-gradient(to right,#d97706,#f59e0b)');
// Indigo: #818cf8 (400) -> #6366f1 (500)
ranking = ranking.replace(/linear-gradient\(to right,#4f46e5,#818cf8\)/g, 'linear-gradient(to right,#4f46e5,#6366f1)');

// Also replace the topBar gradients to be slightly more muted too, just in case
ranking = ranking.replace(/#7dd3fc/g, '#38bdf8'); // sky-300 -> sky-400
ranking = ranking.replace(/#6ee7b7/g, '#34d399'); // emerald-300 -> emerald-400
ranking = ranking.replace(/#c4b5fd/g, '#a78bfa'); // violet-300 -> violet-400
ranking = ranking.replace(/#fda4af/g, '#fb7185'); // rose-300 -> rose-400
ranking = ranking.replace(/#fcd34d/g, '#fbbf24'); // amber-300 -> amber-400
ranking = ranking.replace(/#a5b4fc/g, '#818cf8'); // indigo-300 -> indigo-400

fs.writeFileSync('app/admin/ranking-card.tsx', ranking, 'utf8');
console.log('Fixed ranking-card.tsx');

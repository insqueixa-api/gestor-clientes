const fs = require('fs');

// 1. Toast Notifications - Remove transparency
let toast = fs.readFileSync('app/admin/ToastNotifications.tsx', 'utf8');
toast = toast.replace(/bg-card\/95/g, 'bg-card');
toast = toast.replace(/dark:bg-zinc-900\/95/g, 'dark:bg-card');
toast = toast.replace(/dark:border-emerald-500\/40/g, 'dark:border-emerald-500/20');
toast = toast.replace(/dark:ring-emerald-500\/20/g, 'dark:ring-emerald-500/10');
toast = toast.replace(/dark:border-rose-500\/40/g, 'dark:border-rose-500/20');
toast = toast.replace(/dark:ring-rose-500\/20/g, 'dark:ring-rose-500/10');
toast = toast.replace(/backdrop-blur-md/g, '');
fs.writeFileSync('app/admin/ToastNotifications.tsx', toast, 'utf8');
console.log('Fixed ToastNotifications.tsx');

// 2. Evolucao Client - Use solid, muted hex colors
let evolucao = fs.readFileSync('app/admin/evolucao-client.tsx', 'utf8');

// Replace all L1 and L2 definitions to be strictly solid muted colors.
// emerald-600: #059669, rose-600: #e11d48
evolucao = evolucao.replace(/const L1 = .*/, 'const L1 = "#059669";');
evolucao = evolucao.replace(/const L2 = .*/, 'const L2 = "#e11d48";');

// Replace darkColor in rows to be solid muted colors
evolucao = evolucao.replace(/darkColor: "rgba\(16,185,129,0\.6\)"/g, 'darkColor: "#059669"');
evolucao = evolucao.replace(/darkColor: "rgba\(244,63,94,0\.6\)"/g, 'darkColor: "#e11d48"');

// Replace dots
evolucao = evolucao.replace(/dot: "rgba\(16,185,129,0\.5\)"/g, 'dot: "#047857"');
evolucao = evolucao.replace(/dot: "rgba\(244,63,94,0\.5\)"/g, 'dot: "#be123c"');

fs.writeFileSync('app/admin/evolucao-client.tsx', evolucao, 'utf8');
console.log('Fixed Evolucao');

// 3. RankingCard - Use very soft solid hex colors instead of rgba gradients
let ranking = fs.readFileSync('app/admin/ranking-card.tsx', 'utf8');
// Replace rgba gradients with solid muted colors
// For dark theme, a very dark muted color is best.
// emerald-800: #065f46
// rose-800: #9f1239
ranking = ranking.replace(/linear-gradient\(to right,rgba\(16,185,129,0\.15\),rgba\(16,185,129,0\.4\)\)/g, '#065f46');
ranking = ranking.replace(/linear-gradient\(to right,rgba\(244,63,94,0\.15\),rgba\(244,63,94,0\.4\)\)/g, '#9f1239');
ranking = ranking.replace(/linear-gradient\(to right,rgba\(14,165,233,0\.15\),rgba\(14,165,233,0\.4\)\)/g, '#075985'); // sky-800
ranking = ranking.replace(/linear-gradient\(to right,rgba\(139,92,246,0\.15\),rgba\(139,92,246,0\.4\)\)/g, '#5b21b6'); // violet-800
ranking = ranking.replace(/linear-gradient\(to right,rgba\(245,158,11,0\.15\),rgba\(245,158,11,0\.4\)\)/g, '#92400e'); // amber-800
ranking = ranking.replace(/linear-gradient\(to right,rgba\(99,102,241,0\.15\),rgba\(99,102,241,0\.4\)\)/g, '#3730a3'); // indigo-800

// Also fix the text colors inside RankingCard to be more muted
ranking = ranking.replace(/text-emerald-400/g, 'text-emerald-500');
ranking = ranking.replace(/text-rose-400/g, 'text-rose-500');
ranking = ranking.replace(/text-sky-400/g, 'text-sky-500');
ranking = ranking.replace(/text-amber-400/g, 'text-amber-500');
ranking = ranking.replace(/text-indigo-400/g, 'text-indigo-500');

fs.writeFileSync('app/admin/ranking-card.tsx', ranking, 'utf8');
console.log('Fixed RankingCard');

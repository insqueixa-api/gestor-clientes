const fs = require('fs');

const filesToFix = [
  'app/admin/evolucao-chart.tsx',
  'app/admin/mixed-chart.tsx',
  'app/admin/simplebarchart.tsx'
];

for (const file of filesToFix) {
  if (!fs.existsSync(file)) continue;
  
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Greens
  content = content.replace(/"#34d399"/g, '"#10b981"');
  content = content.replace(/"#4ade80"/g, '"#22c55e"');
  content = content.replace(/"#86efac"/g, '"#22c55e"');

  // Reds
  content = content.replace(/"#fb7185"/g, '"#f43f5e"');
  content = content.replace(/"#f87171"/g, '"#ef4444"');
  content = content.replace(/"#fca5a5"/g, '"#ef4444"');
  
  // Sky
  content = content.replace(/"#38bdf8"/g, '"#0ea5e9"');
  content = content.replace(/"#7dd3fc"/g, '"#38bdf8"');
  
  // Indigo
  content = content.replace(/"#818cf8"/g, '"#6366f1"');
  content = content.replace(/"#a5b4fc"/g, '"#818cf8"');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Fixed colors in ${file}`);
  }
}

const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  try {
    fs.readdirSync(dir).forEach(file => {
      const fp = path.join(dir, file);
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) results = results.concat(walk(fp));
      else if (fp.endsWith('.tsx')) results.push(fp);
    });
  } catch (e) {}
  return results;
}

const files = walk('app/admin');
let totalChanges = 0;
let changedFiles = [];

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let original = content;
  const lines = content.split('\n');
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Skip lines that don't have font-bold
    if (!line.includes('font-bold')) {
      newLines.push(line);
      continue;
    }

    // ===== PRESERVE font-bold in these cases: =====
    
    // 1. Page titles (h1 tags) - keep bold
    if (line.includes('<h1') && line.includes('font-bold')) {
      newLines.push(line);
      continue;
    }

    // 2. Primary action buttons (bg-emerald-600, bg-rose-600, bg-sky-600, bg-purple-600, bg-amber-600)
    // These are CTA buttons that SHOULD be bold
    if (line.includes('bg-emerald-600') || line.includes('bg-rose-600') || 
        line.includes('bg-sky-600') || line.includes('bg-purple-600') ||
        line.includes('bg-amber-600') || line.includes('bg-slate-800')) {
      newLines.push(line);
      continue;
    }

    // 3. Family names in aplicativos (h2 with uppercase tracking-wider)
    if (line.includes('<h2') && line.includes('uppercase') && line.includes('tracking-wider')) {
      newLines.push(line);
      continue;
    }

    // 4. App name titles (h3 with font-bold text-lg) - user wanted these bold
    if (line.includes('<h3') && line.includes('font-bold') && line.includes('text-lg')) {
      newLines.push(line);
      continue;
    }

    // 5. Sidebar menu items in AdminShell
    if (f.includes('AdminShell') && (
      line.includes('text-sm transition-all duration-200 font-bold') ||
      line.includes('text-sm transition-all font-bold') ||
      line.includes('text-sm font-bold text-rose-600')
    )) {
      // Make sidebar items font-medium instead
      line = line.replace(/font-bold/g, 'font-medium');
      newLines.push(line);
      continue;
    }

    // 6. Notification badge count (tiny red circle)
    if (line.includes('rounded-full') && line.includes('bg-rose-500') && line.includes('text-[9px]')) {
      newLines.push(line);
      continue;
    }

    // ===== REPLACE font-bold -> font-medium for everything else =====
    line = line.replace(/font-bold/g, 'font-medium');
    newLines.push(line);
  }

  content = newLines.join('\n');

  if (content !== original) {
    fs.writeFileSync(f, content, 'utf8');
    const changeCount = (original.match(/font-bold/g) || []).length - (content.match(/font-bold/g) || []).length;
    changedFiles.push({ file: f, changes: changeCount });
    totalChanges += changeCount;
  }
});

console.log(`\nChanged ${changedFiles.length} files with ${totalChanges} font-bold -> font-medium replacements:\n`);
changedFiles.forEach(c => console.log(`  ${c.changes} changes in ${c.file}`));

// Now count remaining font-bold
let remaining = 0;
files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  const count = (c.match(/font-bold/g) || []).length;
  if (count > 0) {
    console.log(`  [KEPT] ${count} font-bold in ${f}`);
    remaining += count;
  }
});
console.log(`\nTotal font-bold remaining (preserved): ${remaining}`);

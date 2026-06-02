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

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let original = content;

  // Replace "bg-slate-50 dark:bg-background" with just "bg-background"
  // This is the main page-level background class that prevents the CSS variable from working
  content = content.replace(/bg-slate-50 dark:bg-background/g, 'bg-background');

  if (content !== original) {
    fs.writeFileSync(f, content, 'utf8');
    console.log('Fixed:', f);
    totalChanges++;
  }
});

console.log(`\nTotal files fixed: ${totalChanges}`);

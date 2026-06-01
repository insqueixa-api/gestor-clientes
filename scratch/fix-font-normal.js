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

  // Replace standalone font-normal with font-medium  
  // But preserve dark:font-normal (it's a deliberate dark mode override)
  // We need to be careful: "font-normal" but NOT "dark:font-normal"
  content = content.replace(/(?<!dark:)font-normal/g, 'font-medium');

  if (content !== original) {
    const changes = (original.match(/(?<!dark:)font-normal/g) || []).length;
    fs.writeFileSync(f, content, 'utf8');
    console.log(`  ${changes} changes in ${f}`);
    totalChanges += changes;
  }
});

console.log(`\nTotal font-normal -> font-medium: ${totalChanges}`);

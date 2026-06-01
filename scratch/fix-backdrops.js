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

  // Replace heavy backdrops: bg-black/70, /80, /90 -> bg-black/50
  content = content.replace(/bg-black\/90/g, 'bg-black/50');
  content = content.replace(/bg-black\/80/g, 'bg-black/50');
  content = content.replace(/bg-black\/70/g, 'bg-black/50');

  if (content !== original) {
    fs.writeFileSync(f, content, 'utf8');
    console.log('Fixed backdrops in', f);
    totalChanges++;
  }
});

console.log(`\nFixed ${totalChanges} files`);

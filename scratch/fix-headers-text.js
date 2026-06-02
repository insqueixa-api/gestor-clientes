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

const files = walk('app');
let totalChanges = 0;

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let original = content;

  // 1. Fix h1 text color (page titles)
  content = content.replace(
    /<h1([^>]*)text-slate-800 dark:text-white([^>]*)>/g,
    '<h1$1text-foreground$2>'
  );
  
  // also catch cases where it might be dark:text-white text-slate-800
  content = content.replace(
    /<h1([^>]*)dark:text-white text-slate-800([^>]*)>/g,
    '<h1$1text-foreground$2>'
  );

  // 2. Fix paragraph text color right after h1 (usually page descriptions)
  // Look for `<p className="... text-slate-500 dark:text-white/60 ...">` or similar
  content = content.replace(
    /<p([^>]*)text-slate-500 dark:text-white\/60([^>]*)>/g,
    '<p$1text-foreground/70$2>'
  );
  content = content.replace(
    /<p([^>]*)text-slate-500 dark:text-muted-foreground([^>]*)>/g,
    '<p$1text-foreground/70$2>'
  );
  content = content.replace(
    /<p([^>]*)text-slate-500([^>]*)>/g,
    '<p$1text-foreground/70$2>'
  );

  if (content !== original) {
    fs.writeFileSync(f, content, 'utf8');
    console.log('Fixed headers in:', f);
    totalChanges++;
  }
});

console.log(`\nTotal files fixed: ${totalChanges}`);

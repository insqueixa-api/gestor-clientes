const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('app/admin');
let changedFiles = 0;

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let original = content;

  // Replace standard px/py + rounded/rounded-full + text-[10px] + font-bold
  content = content.replace(
    /px-\d+(?:\.\d+)?\s+py-\d+(?:\.\d+)?\s+rounded(?:-full)?\s+text-\[10px\]\s+font-bold/g,
    'gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm'
  );

  // Replace inverted order (text-[10px] font-bold px... rounded-full)
  content = content.replace(
    /text-\[10px\]\s+font-bold\s+px-\d+(?:\.\d+)?\s+py-\d+(?:\.\d+)?\s+rounded(?:-full)?/g,
    'gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm'
  );

  // Replace text-xs font-bold px... rounded-full (used in some places)
  content = content.replace(
    /text-xs\s+font-bold\s+px-\d+(?:\.\d+)?\s+py-\d+(?:\.\d+)?\s+rounded(?:-full)?/g,
    'gap-1 px-2 py-1 rounded-lg text-xs font-medium tracking-tight shadow-sm'
  );
  
  content = content.replace(
    /px-\d+(?:\.\d+)?\s+py-\d+(?:\.\d+)?\s+rounded(?:-full)?\s+text-xs\s+font-bold/g,
    'gap-1 px-2 py-1 rounded-lg text-xs font-medium tracking-tight shadow-sm'
  );

  // Generic inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border
  content = content.replace(
    /inline-flex\s+items-center\s+gap-1\s+px-2\s+py-1\s+rounded-lg\s+text-\[10px\]\s+font-medium\s+tracking-tight\s+shadow-sm\s+uppercase\s+border/g,
    'inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium tracking-tight shadow-sm uppercase' // Deduplicate border
  );

  // Fix up duplicate gaps/borders if any
  content = content.replace(/gap-1\s+gap-1/g, 'gap-1');
  content = content.replace(/rounded-lg\s+rounded-lg/g, 'rounded-lg');

  if (content !== original) {
    fs.writeFileSync(f, content, 'utf8');
    console.log('Fixed badges in:', f);
    changedFiles++;
  }
});

console.log(`Total files changed: ${changedFiles}`);

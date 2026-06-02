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

  // Remove "font-mono" from lines that contain monetary values, phone numbers, or quantities
  // BUT KEEP font-mono in:
  //   - API keys, URLs, codes (api-server, profile pages with technical fields)
  //   - textarea/input fields (editor de mensagem)
  //   - IDs and technical data
  
  const lines = content.split('\n');
  const newLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    if (!line.includes('font-mono')) {
      newLines.push(line);
      continue;
    }
    
    // KEEP font-mono in these contexts:
    // 1. Input/textarea/select fields (user types in them)
    if (line.includes('<input') || line.includes('<textarea') || line.includes('<select') || line.includes('className=\"pl-')) {
      newLines.push(line);
      continue;
    }
    
    // 2. API keys, URLs, technical IDs (api-server pages)
    if (f.includes('api-server') || f.includes('nova_integracao')) {
      newLines.push(line);
      continue;
    }
    
    // 3. Profile page technical fields (WhatsApp tokens, API configs)
    if (f.includes('profile') && (line.includes('font-mono text-xs') || line.includes('text-xs font-mono'))) {
      newLines.push(line);
      continue;
    }
    
    // 4. Message template preview and editor (font-mono is intentional for code-like text)
    if (f.includes('mensagem') && (line.includes('whitespace-pre-wrap') || line.includes('min-h-'))) {
      newLines.push(line);
      continue;
    }
    
    // 5. novo_servidor DNS input
    if (f.includes('novo_servidor') && (line.includes('absolute left-3') || line.includes('pl-8'))) {
      newLines.push(line);
      continue;
    }
    
    // 6. Data/hora timestamps (these look ok as mono)
    if (line.includes('whitespace-nowrap') && line.includes('text-[11px]') && line.includes('opacity')) {
      newLines.push(line);
      continue;
    }

    // 7. Server API key display
    if (f.includes('servidor') && f.includes('page') && line.includes('select-all')) {
      newLines.push(line);
      continue;
    }
    
    // REMOVE font-mono from everything else (values, phones, amounts, etc.)
    line = line.replace(/\s*font-mono\s*/g, ' ').replace(/\s+/g, ' ');
    // Also clean up "font-mono" that's part of className strings
    line = line.replace(/font-mono /g, '');
    line = line.replace(/ font-mono/g, '');
    line = line.replace(/font-mono/g, '');
    newLines.push(line);
  }
  
  content = newLines.join('\n');
  
  if (content !== original) {
    fs.writeFileSync(f, content, 'utf8');
    console.log('Fixed font-mono in:', f);
    totalChanges++;
  }
});

console.log(`\nTotal files changed: ${totalChanges}`);

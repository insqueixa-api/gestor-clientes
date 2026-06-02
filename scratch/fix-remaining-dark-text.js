const fs = require('fs');

const file = 'app/renew/RenewClient.tsx';
let c = fs.readFileSync(file, 'utf8');
let original = c;

// Fix remaining dark text colors that clash with the dark background
c = c.replace(/text-blue-800/g, 'text-blue-300');
c = c.replace(/text-emerald-800/g, 'text-emerald-300');

// Just in case, let's check for any 900s
c = c.replace(/text-blue-900/g, 'text-blue-300');
c = c.replace(/text-emerald-900/g, 'text-emerald-300');

if (c !== original) {
  fs.writeFileSync(file, c, 'utf8');
  console.log('Fixed remaining dark text colors in RenewClient.tsx');
} else {
  console.log('No changes needed.');
}

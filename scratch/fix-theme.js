const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

const targetDirs = ['app', 'components'];
const skipFiles = [
  'app/login/page.tsx', 
  'app/LoginClient.tsx', 
  'app/renew/page.tsx', 
  'app/renew/RenewClient.tsx', 
  'app/reset-password/page.tsx'
];

let changedFilesCount = 0;

targetDirs.forEach(dir => {
  if (fs.existsSync(dir)) {
    walkDir(dir, (filePath) => {
      if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) return;
      
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (skipFiles.some(skip => normalizedPath.includes(skip))) return;

      let content = fs.readFileSync(filePath, 'utf8');
      let originalContent = content;

      // Safe replacements for colors that shouldn't be hardcoded dark in light mode
      const replacements = [
        { regex: /(?<!dark:)bg-zinc-900(?!\/|\])/g, replace: 'bg-card dark:bg-zinc-900' },
        { regex: /(?<!dark:)bg-zinc-950(?!\/|\])/g, replace: 'bg-background dark:bg-zinc-950' },
        { regex: /(?<!dark:)bg-zinc-800(?!\/|\])/g, replace: 'bg-muted dark:bg-zinc-800' },
        { regex: /(?<!dark:)border-zinc-800(?!\/|\])/g, replace: 'border-border dark:border-zinc-800' },
        { regex: /(?<!dark:)border-zinc-700(?!\/|\])/g, replace: 'border-border dark:border-zinc-700' },
        { regex: /(?<!dark:)text-zinc-400(?!\/|\])/g, replace: 'text-muted-foreground dark:text-zinc-400' },
        { regex: /(?<!dark:)text-gray-400(?!\/|\])/g, replace: 'text-muted-foreground dark:text-gray-400' },
        { regex: /(?<!dark:)text-zinc-300(?!\/|\])/g, replace: 'text-muted-foreground dark:text-zinc-300' },
        { regex: /(?<!dark:)text-zinc-200(?!\/|\])/g, replace: 'text-foreground dark:text-zinc-200' },
        { regex: /(?<!dark:)text-zinc-100(?!\/|\])/g, replace: 'text-foreground dark:text-zinc-100' },
        { regex: /(?<!dark:)placeholder-zinc-500(?!\/|\])/g, replace: 'placeholder-muted-foreground dark:placeholder-zinc-500' },
        { regex: /(?<!dark:)placeholder-zinc-400(?!\/|\])/g, replace: 'placeholder-muted-foreground dark:placeholder-zinc-400' },
        
        // Hex values
        { regex: /(?<!dark:)bg-\[\#18181b\]/g, replace: 'bg-card dark:bg-[#18181b]' },
        { regex: /(?<!dark:)bg-\[\#09090b\]/g, replace: 'bg-background dark:bg-[#09090b]' },
        { regex: /(?<!dark:)border-\[\#27272a\]/g, replace: 'border-border dark:border-[#27272a]' },
      ];

      replacements.forEach(({regex, replace}) => {
        content = content.replace(regex, replace);
      });

      // text-white is tricky. Replace text-white with text-foreground dark:text-white ONLY if it's not near bg-{color}
      let lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.includes('text-white') && !line.includes('dark:text-white')) {
          const hasColoredBg = /bg-(emerald|green|blue|sky|amber|yellow|red|rose|purple|indigo|violet|teal|cyan|orange|pink)-[4567]00/.test(line);
          const hasDarkBgClass = /bg-zinc-900|bg-zinc-950|bg-black|bg-slate-900/.test(line); // If it still has dark bg for some reason, maybe we shouldn't touch it, but we already replaced them.
          if (!hasColoredBg) {
             lines[i] = line.replace(/(?<!dark:)text-white(?!\/)(?!\w)/g, 'text-foreground dark:text-white');
          }
        }
      }
      content = lines.join('\n');

      // Cleanup duplicated bg-card, bg-background etc that might occur if the class was already there
      content = content.replace(/bg-card\s+bg-card/g, 'bg-card');
      content = content.replace(/bg-background\s+bg-background/g, 'bg-background');
      content = content.replace(/border-border\s+border-border/g, 'border-border');
      content = content.replace(/text-muted-foreground\s+text-muted-foreground/g, 'text-muted-foreground');
      content = content.replace(/text-foreground\s+text-foreground/g, 'text-foreground');

      // Clean up cases where we might have generated `bg-card dark:bg-card`
      content = content.replace(/bg-card\s+dark:bg-card/g, 'bg-card');
      content = content.replace(/bg-background\s+dark:bg-background/g, 'bg-background');
      content = content.replace(/text-foreground\s+dark:text-foreground/g, 'text-foreground');
      content = content.replace(/text-muted-foreground\s+dark:text-muted-foreground/g, 'text-muted-foreground');

      // specific fix for some inputs
      content = content.replace(/bg-zinc-900\/50/g, 'bg-muted/50 dark:bg-zinc-900/50');
      
      if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Fixed: ' + filePath);
        changedFilesCount++;
      }
    });
  }
});

console.log(`\nProcess completed. Fixed ${changedFilesCount} files.`);

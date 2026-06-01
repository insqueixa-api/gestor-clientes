const fs = require('fs');

function replaceInFile(file, replacer) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;
    content = replacer(content);
    if (content !== original) {
      fs.writeFileSync(file, content, 'utf8');
      console.log('Fixed', file);
    }
  }
}

// 1. SERVIDORES
const servidorFiles = [
  'app/admin/gerenciador/servidor/page.tsx',
  'app/admin/gerenciador/servidor/[id]/page.tsx',
  'app/admin/gerenciador/servidor/novo_servidor.tsx',
  'app/admin/gerenciador/servidor/recarga_servidor.tsx',
  'app/admin/revendedor/[id]/vincular_servidor.tsx',
];

servidorFiles.forEach(file => {
  replaceInFile(file, (c) => {
    // Remove font-bold mostly, except maybe from main buttons
    // We'll replace font-bold with font-normal in spans, divs, th, td, p
    c = c.replace(/<(span|div|th|td|p|h2|h3)([^>]*)font-bold([^>]*)>/g, '<$1$2font-normal$3>');
    c = c.replace(/<(span|div|th|td|p|h2|h3)([^>]*)font-semibold([^>]*)>/g, '<$1$2font-normal$3>');
    // Also remove from classNames that are built dynamically like `font-bold`
    c = c.replace(/className="([^"]*)font-bold([^"]*)"/g, (match, p1, p2) => {
      // If it's a button, keep it bold? The user said "remove todos esses negritos". We can change to font-medium for buttons or just font-normal. Let's use font-normal everywhere.
      return `className="${p1}font-normal${p2}"`;
    });
    return c;
  });
});

// 2. PLANOS
const planoFiles = [
  'app/admin/gerenciador/plano/page.tsx',
  'app/admin/gerenciador/plano/plano_modal.tsx',
];

planoFiles.forEach(file => {
  replaceInFile(file, (c) => {
    // "planos, os valores não precisam ser em negrito..."
    // Find text that renders the price, usually font-bold
    // text-lg font-bold text-slate-800 dark:text-white
    c = c.replace(/text-lg font-bold/g, 'text-lg font-normal');
    c = c.replace(/text-xl font-bold/g, 'text-xl font-normal');
    c = c.replace(/text-base font-bold/g, 'text-base font-normal');
    c = c.replace(/text-sm font-bold/g, 'text-sm font-normal');
    c = c.replace(/text-2xl font-bold/g, 'text-2xl font-normal'); // Just in case
    return c;
  });
});

// 3. MENSAGENS / AUTOMAÇÃO
const mensagemFiles = [
  'app/admin/gerenciador/mensagem/page.tsx',
  'app/admin/gerenciador/cobranca/page.tsx', // automacao de cobrancas
];

mensagemFiles.forEach(file => {
  replaceInFile(file, (c) => {
    // "os titulos das mensagens tbm nao precisam ser em negritos..."
    // "automação de cobranças tbm, muito negrito e cores fortes... ajusta por favor..."
    c = c.replace(/font-bold/g, 'font-normal');
    c = c.replace(/font-semibold/g, 'font-normal');
    
    // Cores fortes: bg-slate-800, text-white etc in badges?
    // In cobranca/page.tsx, maybe they mean the badges we just fixed? 
    // They were replaced in the previous step, but let's check for bg-red-500, bg-emerald-500 etc.
    c = c.replace(/bg-emerald-500 text-white/g, 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400');
    c = c.replace(/bg-rose-500 text-white/g, 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400');
    c = c.replace(/bg-blue-500 text-white/g, 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400');
    
    return c;
  });
});

// 4. APLICATIVOS
const aplicativoFiles = [
  'app/admin/gerenciador/aplicativo/page.tsx',
];

aplicativoFiles.forEach(file => {
  replaceInFile(file, (c) => {
    // "aplicativos, manteha as familias em negrito e os nomes dos applicativos tbm, mas a integração não precisa, as opções selecionadas, tbm nao precisa ser em negrito"
    // Famílias: usually h2 or similar
    // Nomes dos aplicativos: usually h3 or text-lg font-bold
    // Integração: "GerenciaApp - Integrado"
    // Opções selecionadas: "Device ID (MAC)"

    // Let's manually replace font-bold -> font-normal for integration and options
    // Integration usually has text-[10px] font-bold uppercase or similar
    c = c.replace(/text-\[10px\] font-bold uppercase/g, 'text-[10px] font-normal uppercase');
    c = c.replace(/text-xs font-bold/g, 'text-xs font-normal');
    c = c.replace(/text-sm font-bold text-emerald-600/g, 'text-sm font-normal text-emerald-600');
    
    // For CAMPOS EXIGIDOS:
    c = c.replace(/text-\[9px\] font-bold/g, 'text-[9px] font-normal');
    c = c.replace(/text-\[10px\] font-medium/g, 'text-[10px] font-normal'); // If we previously made them font-medium
    
    return c;
  });
});

console.log('Styling adjustments complete.');

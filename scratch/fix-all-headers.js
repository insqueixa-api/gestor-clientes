const fs = require('fs');

// 1. REVERT API SERVER TO THE STANDARD
let apiServer = fs.readFileSync('app/admin/settings/api-server/page.tsx', 'utf8');
const badApiHeader = /\{\/\* 1\. TÍTULO MOBILE: Rola junto com a tela e desaparece \*\/\}(.|\n)*?\{\/\* 2\. HEADER STICKY: Botões no Mobile \/ Título \+ Botões no Desktop \*\/\}\s*<div className="sticky top-14 md:top-0 z-\[40\] bg-background px-3 pb-3 pt-0 md:pt-0 sm:mx-0 sm:px-0 border-b border-border\/50 dark:border-border sm:border-none flex items-center justify-end md:justify-between shadow-sm sm:shadow-none transition-colors">\s*\{\/\* Título Desktop \(Só aparece em telas grandes\) \*\/\}\s*<div className="min-w-0 text-left hidden md:block">\s*<div className="flex items-center gap-3">\s*<h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">\s*API de Integrações\s*<\/h1>\s*<\/div>\s*<\/div>\s*<div className="flex items-center gap-2 justify-end shrink-0">\s*<div className="relative">\s*<button/m;

const standardApiHeader = `{/* Topo */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              API de Integrações
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <div className="relative">
            <button`;

if (badApiHeader.test(apiServer)) {
  apiServer = apiServer.replace(badApiHeader, standardApiHeader);
  fs.writeFileSync('app/admin/settings/api-server/page.tsx', apiServer, 'utf8');
  console.log('Reverted API server to standard header.');
} else {
  console.log('Could not find bad api server header');
}

// 2. CONVERT FINANCEIRO PESSOAL TO THE STANDARD
let financeiro = fs.readFileSync('app/admin/settings/financeiro_pessoal/page.tsx', 'utf8');
const badFinHeader = /\{\/\* 1\. TÍTULO MOBILE: Rola junto com a tela e desaparece \*\/\}(.|\n)*?\{\/\* 2\. HEADER STICKY: Botões no Mobile \/ Título \+ Botões no Desktop \*\/\}\s*\{\/\* top-14 crava nos exatos 56px da TopBar, fechando qualquer buraco visual \*\/\}\s*<div className="sticky top-14 md:top-0 z-\[40\] bg-background px-3 pb-3 pt-0 md:pt-0 sm:mx-0 sm:px-0 border-b border-border\/50 dark:border-border sm:border-none flex items-center justify-end md:justify-between shadow-sm sm:shadow-none transition-colors">\s*\{\/\* Título Desktop \(Só aparece em telas grandes\) \*\/\}\s*<div className="min-w-0 text-left hidden md:block">\s*<div className="flex items-center gap-3">\s*<h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">\s*Controle Financeiro\s*<\/h1>\s*<EyeToggle \/>\s*<\/div>\s*<\/div>\s*\{\/\* Botões do Calendário \*\//m;

const standardFinHeader = `{/* Topo */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        {/* Título (esquerda) */}
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              Controle Financeiro
            </h1>
            <EyeToggle />
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            onClick={() => setShowMobileCards(!showMobileCards)}
            className="md:hidden text-[11px] font-medium text-muted-foreground bg-black/20 px-2 py-1 rounded-md dark:bg-card/10 dark:border dark:border-white/5 hover:text-white dark:text-muted-foreground transition-colors mr-2"
          >
            {showMobileCards ? "Ocultar Valores" : "Exibir Valores"}
          </button>
          {/* Botões do Calendário */`;

if (badFinHeader.test(financeiro)) {
  financeiro = financeiro.replace(badFinHeader, standardFinHeader);
  fs.writeFileSync('app/admin/settings/financeiro_pessoal/page.tsx', financeiro, 'utf8');
  console.log('Converted Financeiro Pessoal to standard header.');
} else {
  console.log('Could not find bad financeiro header');
}

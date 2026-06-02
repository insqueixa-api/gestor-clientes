const fs = require('fs');
let c = fs.readFileSync('app/admin/settings/financeiro_pessoal/page.tsx', 'utf8');

c = c.replace('unction ModalTransacao({', 'function ModalTransacao({');

fs.writeFileSync('app/admin/settings/financeiro_pessoal/page.tsx', c, 'utf8');
console.log('Fixed unction typo.');

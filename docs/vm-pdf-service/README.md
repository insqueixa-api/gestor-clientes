# Serviço de PDF do informativo de condomínio — HISTÓRICO (não usado mais)

⚠️ **15/09/2026**: a geração de PDF saiu desta VM (Google Cloud) e passou a
rodar num **Cloudflare Worker com Browser Rendering** —
`unigestor-pdf-worker`, projeto separado em
`C:\Users\Marcio\Gestor de Clientes\unigestor-pdf-worker` (fora deste repo,
mesmo padrão da extensão `unigestor-extensao`), publicado em
`https://unigestor-pdf-worker.unigestor.workers.dev`. Chamado pelo Next.js
via `app/api/admin/condominio/gerar-pdf/route.ts`, agora usando as env vars
`PDF_WORKER_URL`/`PDF_WORKER_TOKEN` (antes: `PDF_VM_BASE_URL`/`PDF_VM_TOKEN`).

**Motivo da troca**: a VM (`e2-micro`, ~955MB RAM) não tinha folga real pra
Chromium — ficou evidente durante a tentativa (14-15/09/2026, também
revertida) de consolidar o Duplecast nela também: pressão de memória real
(swap em uso, um crash do FlareSolverr no próprio auto-teste de boot) e o
Cloudflare do Duplecast nunca resolveu de forma confiável ali (nem direto,
nem via proxy ProxyBR, testado e descartado). O Cloudflare Browser
Rendering resolve o problema de raiz: mesmo Chromium real, sem VM nenhuma
pra manter, de graça dentro do limite do plano Free (~5h/mês de navegador —
uso real medido: poucas edições por mês, folga enorme).

**Layout idêntico** — o `template.js` foi portado 1:1 (só convertido de
CommonJS pra ESM) pra `unigestor-pdf-worker/src/template.js`. Mesmo HTML,
mesmo CSS, mesmo `page.pdf()`.

A VM em si (`34.69.145.29`) foi limpa por completo (containers/imagens
Docker removidos) e fica disponível pra qualquer uso futuro — ver
`docs/gcp-vm-disponivel.md`.

---

## Conteúdo desta pasta (arquivos abaixo, mantidos só como referência histórica)

Os arquivos `server.js`, `template.js`, `Dockerfile`, `vm-package.json`
documentam como o serviço rodava ANTES da troca (deploy manual via
`docker build`/`docker run`, direto na VM, nunca buildado pelo Next.js —
`vm-package.json` tem esse nome de propósito pra não disparar o scanner de
monorepo da Vercel, ver aviso original abaixo). Não há mais nada rodando a
partir destes arquivos — ficam aqui só pra consulta caso precise entender o
histórico ou reverter algum dia.

`package.json` deste serviço ficava salvo como `vm-package.json` (não
`package.json`) de propósito: um `package.json` de verdade dentro do repo
fez a Vercel escanear o monorepo e mandar um e-mail "new project available
to import" (achado em 23/08/2026), como se essa pasta fosse um segundo
projeto deployável.

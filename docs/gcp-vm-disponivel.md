# VM do Google Cloud — disponível, sem uso atual

**15/09/2026**: essa VM rodava o serviço de geração de PDF do informativo de
condomínio (Puppeteer). Isso foi migrado pra um Cloudflare Worker com Browser
Rendering (`unigestor-pdf-worker`, projeto separado — ver
`docs/vm-pdf-service/README.md` pro histórico completo da migração e o
porquê). A VM foi **limpa por completo** (containers, imagens Docker e
arquivos do serviço removidos) e está **parada só pra uso futuro**, sem
nenhuma aplicação rodando nela hoje.

**05/10/2026**: continua **ligada, disponível e limpa** pra qualquer teste
futuro (Ubuntu 24.04, só Docker instalado). Foi usada só pra testar o
ClouDDy (resultado na seção abaixo); tudo o que foi instalado pro teste
(Google Chrome, Chrome for Testing, Xvfb, ImageMagick, unzip, sandbox em
`/usr/local/sbin`, pasta `~/clouddy-test`) foi removido no mesmo dia.

## Acesso

- Zona: `us-central1-f`, tipo `e2-micro` (Always Free tier da GCP).
- IP: `34.69.145.29`
- SSH: `ssh -i ~/.ssh/gcp_key marcio@34.69.145.29` (mesma chave `gcp_key`
  usada pra VM da Hetzner — apelido histórico, dá acesso às duas).
- Docker já instalado e funcional (`docker compose`/`docker` disponíveis).

## Recursos reais (confirmado ao vivo, 15/09/2026)

- **~955MB RAM total** — apertado. Rodar mais de um processo pesado ao mesmo
  tempo (ex: 2 Chromium) já mostrou sinais reais de pressão de memória (swap
  em uso, um crash de auto-teste do FlareSolverr) durante a tentativa de
  consolidar o Duplecast aqui (14-15/09/2026, revertida — ver
  `docs/vm-pdf-service/README.md`).
- 1 vCPU (compartilhada/burstable, não dedicada).
- Disco: ~29GB total, ~17GB livres depois da limpeza.
- Elegível ao Always Free tier — sem custo, contanto que continue nesse
  tamanho/região.

## Antes de usar pra algo novo

Dado o histórico acima, essa VM serve bem pra tarefas **leves e sob
demanda** (ex: um serviço que liga, faz uma coisa rápida, desliga) — não é
recomendada pra rodar 2+ processos pesados (Chromium, navegador headless,
etc.) ao mesmo tempo sem redimensionar primeiro (`e2-small`/`e2-medium`,
rápido de trocar pelo console GCP: parar a VM → mudar tipo → religar).

## ClouDDy NÃO roda aqui (testado 05/10/2026)

Ideia testada: tirar o ClouDDy da extensão do navegador do Márcio e rodar
num Chrome na VM. **Não funciona** — não repetir sem um fato novo:

- O login do ClouDDy (`console.clouddy.online/user/auth/login`) tem
  **Cloudflare Turnstile** dentro do formulário.
- Chrome **oficial** (154), parado, sem extensão e sem automação nenhuma,
  só com a página aberta numa tela virtual (Xvfb): a caixinha **"Verify you
  are human" fica parada** e nunca libera. Mesmo resultado com Chrome for
  Testing + extensão (sem CDP): "Verifying..." → volta pra caixinha.
- Ou seja, o bloqueio aqui é o **ambiente** (IP de datacenter do Google +
  sem GPU/WebGL + tela virtual), não o jeito de controlar o navegador. Em
  julho/2026 o Playwright (CDP) já tinha falhado por outro motivo.
- FlareSolverr não resolve: ele trata a página "Just a moment" do
  Cloudflare, não o Turnstile interativo de formulário.
- Fazer a VM "parecer humana" (proxy residencial, simular clique) foi
  descartado de propósito: é driblar a proteção anti-robô do ClouDDy, e
  quebraria a qualquer ajuste do Cloudflare.
- ClouDDy não tem API oficial (o Márcio confirmou que não vai rolar). O
  único caminho que funciona é a **extensão no navegador do Márcio**
  (`unigestor-extensao`, v1.2 — hoje só com o ClouDDy).

Detalhes técnicos que ficam de lição pra qualquer teste com Chrome aqui:
- Google Chrome oficial ≥137 **ignora `--load-extension`** (até com
  `--disable-features=DisableLoadExtensionCommandLineSwitch`); pra carregar
  extensão por linha de comando precisa do Chrome for Testing.
- Ubuntu 24.04 bloqueia o sandbox do Chrome for Testing (AppArmor/userns):
  ou configura o `chrome_sandbox` SUID (`CHROME_DEVEL_SANDBOX`) ou nada
  abre.
- Num `ssh ... 'comando'`, nunca usar `pkill -f`/`pgrep -f` com um texto
  que também aparece no próprio comando — ele mata a própria sessão SSH.

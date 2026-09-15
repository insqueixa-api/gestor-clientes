# VM do Google Cloud — disponível, sem uso atual

**15/09/2026**: essa VM rodava o serviço de geração de PDF do informativo de
condomínio (Puppeteer). Isso foi migrado pra um Cloudflare Worker com Browser
Rendering (`unigestor-pdf-worker`, projeto separado — ver
`docs/vm-pdf-service/README.md` pro histórico completo da migração e o
porquê). A VM foi **limpa por completo** (containers, imagens Docker e
arquivos do serviço removidos) e está **parada só pra uso futuro**, sem
nenhuma aplicação rodando nela hoje.

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

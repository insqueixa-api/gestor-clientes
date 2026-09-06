# Serviço de WhatsApp (VM Hetzner)

Sessão WhatsApp Web (Baileys, multi-device) rodando numa VM própria — não em função serverless da Vercel, que não é lugar pra uma conexão persistente (WebSocket) de longa duração. É o serviço que manda todas as mensagens reais (cobrança, confirmação de pagamento, etc.) via `app/api/whatsapp/*` no Next.js.

**Diferente do `docs/vm-pdf-service/`**: aqui o código-fonte de verdade já mora neste diretório (`whatsapp-service/`) na raiz do repo, não em `docs/`. `package.json` normal mesmo (não precisou do truque de renomear pra escapar do scanner de monorepo da Vercel — não deu o mesmo problema até hoje).

## Onde roda

- VM: `unigestor-whatsapp` — **Hetzner Cloud**, tipo `cx23`, IP `204.168.137.150`.
- SSH: `ssh -i ~/.ssh/gcp_key root@204.168.137.150` (mesma chave `gcp_key` usada pra VM do PDF no Google Cloud — apelido histórico, dá acesso às duas).
- Diretório na VM: `/opt/whatsapp-service` (mesma estrutura deste diretório aqui).
- `docker-compose.yml` sobe 2 containers: `unigestor-whatsapp` (este serviço, porta `3000`) e `flaresolverr` (resolve desafio Cloudflare pro Duplecast/Downdetector, só acessível internamente — `127.0.0.1:8191`, nunca exposto).
- Sessões (credenciais do WhatsApp) persistem em `/opt/whatsapp-service/auth/` — volume Docker, sobrevive a rebuild/restart do container.
- Reiniciar a VM via API do Hetzner: `HETZNER_API_TOKEN`/`HETZNER_SERVER_ID` em `.env.local` do projeto principal (usado por `app/api/whatsapp/vm-reboot`).

## Variáveis de ambiente (`.env` na VM, nunca commitado — `.gitignore` já cobre `.env*`)

| Variável | Pra que serve | Onde conseguir |
|---|---|---|
| `API_TOKEN` | Autentica TODA chamada do app → VM (`Authorization: Bearer`). É o MESMO valor de `UNIGESTOR_WA_TOKEN` no `.env.local`/Vercel do projeto principal — confirmado byte a byte (usado também no sentido inverso, VM → app, na rota `session-alert`). | Gerado uma vez, string aleatória longa. Trocar nos dois lados juntos se rotacionar. |
| `PORT` | Porta do Express (`3000`). | Fixo. |
| `CALL_REJECT_MESSAGE` | Texto enviado quando alguém liga e a sessão está configurada pra rejeitar chamadas. | Texto livre. |
| `UNIGESTOR_APP_URL` | URL do app Next.js — usado pra montar a `notification_url` de gateways de pagamento e pra `reportSessionAlert` (hard reset) chamar `/api/whatsapp/session-alert` de volta. | `https://unigestor.net.br`. |
| `NEXT_PUBLIC_APP_URL` | Idem, usado em outro ponto do código (legado, mesmo valor). | `https://unigestor.net.br`. |
| `EPG_SYNC_CRON_SECRET` | Não usado pelo `whatsapp-service` em si — sobra de uma variável compartilhada com outro serviço da VM (`fast-sync/sync-fast.cjs`, cron do crontab do sistema). | Ver `docs/sql`/memória do EPG. |
| `WHATSAPP_PROXY_URL` | Proxy residencial dedicado (ipbr.pro) — todo tráfego do socket WhatsApp (`agent`/`fetchAgent` do Baileys) sai por ele, IP fixo brasileiro em vez do IP de datacenter da Hetzner (evita logout forçado por "padrão de datacenter"). | Painel do provedor (ipbr.pro/"Proxy BR"). |

## Como fazer deploy de uma atualização

```bash
# 1. Editar os arquivos aqui no repo (src/sessionManager.js, src/index.js, etc.)

# 2. Copiar pra VM:
scp -i ~/.ssh/gcp_key whatsapp-service/src/sessionManager.js whatsapp-service/src/index.js root@204.168.137.150:/opt/whatsapp-service/src/
# (se mudou docker-compose.yml/Dockerfile/package.json/.dockerignore, copiar também)

# 3. Rebuildar e trocar o container:
ssh -i ~/.ssh/gcp_key root@204.168.137.150 "cd /opt/whatsapp-service && docker compose up -d --build"

# 4. Conferir saúde:
ssh -i ~/.ssh/gcp_key root@204.168.137.150 "docker ps --format 'table {{.Names}}\t{{.Status}}' && docker logs unigestor-whatsapp --since=1m"
```

Reconecta sozinho usando a sessão salva (`auth/`) — não precisa escanear QR de novo, a menos que tenha sido um Hard Reset.

## Contrato da API (principais rotas — ver `src/index.js` pra lista completa)

Todas exigem `Authorization: Bearer <API_TOKEN>`; a maioria também exige `x-session-key` (hash gerado por `makeSessionKey()` em `lib/whatsapp/wa-context.ts` do app principal).

- `GET /health` — sem auth, usado pelo healthcheck do Docker.
- `GET /status` — status da sessão (`connected`/`connecting`/`disconnected`/`qr`).
- `GET /qr` — QR code em base64 pra parear um número novo.
- `POST /send` — manda mensagem de verdade. Resposta inclui `sessionHealth` (ver abaixo).
- `GET /session-health` — consulta (e ZERA) os contadores de erro de sessão/decriptação acumulados desde a última consulta. Chamado sob demanda (botão "Sincronizar agora" no painel Sistema, ou embutido na resposta de um `/send` real) — **sem timer nenhum rodando sozinho na VM**.
- `POST /disconnect` / `POST /reconnect` — soft: reaproveita a sessão salva, sem apagar nada.
- `POST /system/hard-reset` — apaga a(s) sessão(ões) por completo, exige QR novo. Dispara alerta (sino+e-mail) automaticamente via `/api/whatsapp/session-alert`.

## Achados/decisões importantes

- **Proxy residencial obrigatório**: conectar direto do IP de datacenter da Hetzner causava logout forçado (401) repetido — a WhatsApp reconhece padrão de datacenter. Ver comentário no topo de `sessionManager.js`.
- **Fingerprint do "aparelho vinculado" (`browser:`) auto-atualizável**: busca a versão estável atual do Chrome na API pública do Google 1x/dia — ficar congelado (era Chrome 124 desde ago/2026) é um padrão que sistemas antifraude associam a automação.
- **`keepAliveIntervalMs: 15_000`** — reduzido de 30s (dá mais margem antes da WhatsApp considerar o túnel morto se um "Alô?" falhar).
- **Simulação de presença ociosa**: além de ficar "disponível" ao redor de um envio real, também fica online por alguns minutos em intervalos aleatórios (20-90min), sem relação com envio — imita alguém abrindo o app à toa.
- **`SESSION_HEALTH` (Bad MAC/Failed to decrypt/Closing session/recv retry request)**: sintoma direto de mensagens que chegam como "Aguardando mensagem"/vazias pro destinatário. Contado via `getAndResetSessionHealth()` — quando SUSTENTADO (3+ consultas seguidas com erro), a própria VM já tenta reconectar sozinha (soft) antes de avisar; sino+e-mail só disparam se for sustentado ou um pico isolado alto (evita alarme falso em erro pontual, que o próprio Baileys já autocorrige na maioria das vezes).
- **Disjuntor de emergência**: `sendMessage()` recusa envio acima de 60 mensagens/5min — teto rígido, não configurável em tela nenhuma, última linha de defesa contra um bug/config errada virar um evento de banimento por disparo em massa.
- **Sem backup automático da VM** (decisão consciente, margem pequena não justifica o custo) — recuperação em caso de desastre é reconstruir do zero + `docker compose up` (este repo já tem tudo) + re-parear via QR.

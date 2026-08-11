# Tela: Settings › WhatsApp (`/admin/settings/whatsapp`)

Arquivo: [app/admin/settings/whatsapp/page.tsx](../../app/admin/settings/whatsapp/page.tsx)

## O que é

Painel das 2 sessões de WhatsApp (Principal e Secundário) usadas pelas automações de cobrança e envios manuais. Cada sessão mostra QR code para conectar, avatar/nome/telefone quando conectado, toggle "Rejeitar Chamadas" com mensagem customizável e lista de números permitidos, e botões Atualizar/Reconectar/Desconectar. Um modal separado de "Manutenção VM" oferece 3 níveis de escalada: reiniciar serviço, reiniciar VM (Hetzner), hard reset (apaga as 2 sessões).

## De onde vêm os dados

- **`whatsapp_allowed_numbers_backup`** — chave `(tenant_id, session_label)`, backup manual da lista de números permitidos.
- Todo o estado "vivo" (QR, status, config, lista ativa) vive na **VM externa**, não no Supabase — o Supabase só guarda um backup de segurança da lista permitida.

## Rotas de API chamadas

Todas passam por `app/api/whatsapp/[action]/route.ts` (rota dinâmica única) → `lib/whatsapp/wa-context.ts`:
- `GET status[2]`, `GET qr[2]`, `GET profile[2]`, `GET/POST config[2]`, `POST disconnect[2]`/`reconnect[2]` — por sessão.
- `POST /api/whatsapp/allowed-backup` — backup/restore da lista permitida no Supabase.
- `POST /api/whatsapp/restart-service` — reinicia o serviço na VM.
- `POST /api/whatsapp/hard-reset` — reseta **as 2 sessões ao mesmo tempo** (não dá pra resetar só uma).
- `POST /api/whatsapp/vm-reboot` — reboot da VM inteira via **API da Hetzner Cloud**.

## Integrações externas

VM própria de WhatsApp (autenticada por `sessionKey` = SHA-256 de `tenantId:userId`), **Hetzner Cloud API** (hospedagem da VM).

## Sobre "restrição de números"/"variação de mensagem" (memória do projeto)

**Não encontrado nesta tela.** A funcionalidade de "Números Permitidos" aqui é sobre **rejeitar chamadas de voz** seletivamente — não tem relação com a restrição de números por disparo em massa nem com variações de texto anti-detecção. Essas duas coisas vivem em outro lugar: variação de texto é `/api/whatsapp/generate-variant` (usada em [gerenciador-mensagem.md](gerenciador-mensagem.md)) e nos envios (`envio_agora`, `envio_avulso`, `envio_programado`, `envio_simulado`), nenhum chamado por esta tela.

## Achados (não alterados — já são comportamento intencional/documentado)

1. Hard reset é atômico para as 2 sessões — o confirm já avisa isso claramente, é limitação de design, não bug.
2. Um comentário no código documenta um bug antigo já corrigido (sobrescrita da lista de números permitidos por `saveConfig()` disparado antes do primeiro `fetchConfig()` bem-sucedido) — a correção (`configLoaded` guard) está implementada corretamente, é só registro histórico.
3. Backup da lista de números é manual (clique explícito), não automático — proteção "de segunda camada" por design.

## Sugestão de melhoria

- Considerar sync automático (debounced) do backup da lista permitida a cada `saveConfig()` bem-sucedido, em vez de depender só do clique manual em "Backup".

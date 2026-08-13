# Tela: Gerenciador de Servidor (`/admin/gerenciador/servidor`)

Arquivos: [app/admin/gerenciador/servidor/page.tsx](../../app/admin/gerenciador/servidor/page.tsx), `novo_servidor.tsx`, `recarga_servidor.tsx`

## O que é

CRUD de servidores IPTV (créditos, DNS, painel, WhatsApp do portal), com sincronização de saldo via integrações externas (Fast/NaTV/Elite) e registro de compras de crédito.

## De onde vêm os dados

- **`vw_servers_active`** / **`vw_servers_archived`** — listagem principal.
- **`vw_clients_list_active`**, **`vw_clients_list_archived`**, **`vw_trials_list_active`**, **`reseller_servers`**, **`vw_server_integrations`** — estatísticas por servidor.
- **`servers`** — leitura de `credits_available`.
- **`server_integrations`** (`api_token, api_secret, api_base_url, provider, credits_last_known, owner_username`) — lida/gravada pelas rotas de sync.
- **`server_credit_purchases`** — histórico de compras/recargas. **Confirmado o vínculo com o Dashboard**: é essa tabela que alimenta o campo "Despesas"/"Lucro" em `get_dashboard_iptv_bundle` (ver [dashboard.md](dashboard.md)).
- **`tenant_fx_rates`** — cotação USD/EUR→BRL na recarga.

## Rotas de API chamadas

- `POST /api/integrations/fast/sync` — chama `api.painelcliente.com/profile/{token}`, atualiza `server_integrations`.
- `POST /api/integrations/natv/sync` — mesmo padrão.
- `POST /api/integrations/elite/sync` — 2 ações: `get_credentials` (devolve credenciais pra extensão) e `save_sync` (grava saldo lido de volta).
- RPCs: `toggle_server_archive`, `delete_archived_server`, `update_server_credits_manual`, `log_server_credit_purchase_only` e `topup_server_credits_and_log` (ambas `SECURITY DEFINER` guardadas por `tenant_members`, com validação de valores > 0 — confirmado em `docs/sql/fix_unguarded_security_definer_functions.sql`).
- `POST /api/upload/presign` — logo do servidor.
- `GET /api/whatsapp/profile[2]` — status de sessão para o select "Sessão para o Portal".

## Integrações externas

**Fast** (`api.painelcliente.com`), **NaTV**, **Elite** (via extensão de navegador, mesmo padrão de [clientes.md](clientes.md)), WhatsApp.

A tela decide qual RPC de compra chamar com base em `hasIntegration`: com integração, `log_server_credit_purchase_only` (só loga — o saldo vem do sync); sem integração, `topup_server_credits_and_log` (loga E soma ao saldo).

## Achado que fica para confirmação (envolve dinheiro — não alterado)

1. **Ordem log→sync na recarga de servidor com integração pode divergir "dinheiro gasto" de "créditos disponíveis" temporariamente.** Quando o servidor tem integração, o fluxo é: 1) loga a compra (RPC), 2) sincroniza o painel externo — e só o sync atualiza `credits_available` de fato. Se o passo 2 falhar (extensão Elite não instalada, Fast/NaTV fora do ar), a compra **já foi registrada no financeiro/Dashboard** (aumentando "Despesas"), mas o saldo de créditos do servidor não reflete isso até um sync manual bem-sucedido. Não é corrupção de dado (o log é real, a compra aconteceu), mas a ordem das operações é uma decisão que prefiro confirmar antes de inverter (sync primeiro, log depois muda o comportamento em caso de falha parcial).

## Achados de baixo risco (não alterados)

2. `handleSyncIntegration` (`page.tsx`), `recarga_servidor.tsx` e `novo_servidor.tsx` têm **3 cópias quase idênticas** do fluxo Elite/Fast/NaTV (get_credentials → evento de extensão → save_sync) — funciona, mas uma correção de fluxo precisa ser replicada manualmente em 3 lugares.
3. `recarga_servidor.tsx` usa múltiplos nomes de coluna alternativos ao pré-preencher a última recarga (`data.credits_qty ?? data.qty_credits ?? data.quantity`, etc.) — sugere incerteza sobre o schema real de `server_credit_purchases`, provavelmente resquício de renomeações passadas de coluna. Vale confirmar o schema atual e simplificar.

## Sugestão de melhoria

- Extrair o fluxo de sync Elite/Fast/NaTV (achado 2) para uma função compartilhada em `lib/`, em vez de 3 cópias.

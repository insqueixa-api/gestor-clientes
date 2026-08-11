# Tela: Clientes (`/admin/cliente` e `/admin/cliente/[id]`)

A tela mais importante do sistema — cadastro, renovação, cobrança e conexão de apps de todos os clientes IPTV.

Arquivos principais:
- [app/admin/cliente/page.tsx](../../app/admin/cliente/page.tsx) — lista
- [app/admin/cliente/[id]/page.tsx](../../app/admin/cliente/%5Bid%5D/page.tsx) — ficha do cliente
- [app/admin/cliente/novo_cliente.tsx](../../app/admin/cliente/novo_cliente.tsx) — modal de criar/editar (cliente ou teste), ~6.400 linhas
- [app/admin/cliente/recarga_cliente.tsx](../../app/admin/cliente/recarga_cliente.tsx) — modal de renovar/converter, ~2.500 linhas
- [app/admin/settings/cupons/cupom_modal.tsx](../../app/admin/settings/cupons/cupom_modal.tsx) — cupom pessoal (reaproveitado aqui)

## O que é

**Lista**: tabela paginada/filtrada/ordenada inteiramente no banco (nada em memória) — busca, 5 filtros combináveis (os mesmos que o Dashboard usa via `?filter=`, ver [dashboard.md](dashboard.md)), ações rápidas por linha (mensagem, renovar, editar, alerta, arquivar, excluir), e 3 modais de mensagem (agora / programar / simulado).

**Ficha do cliente**: assinatura atual, contatos (com foto sincronizada WhatsApp → Google Contacts), apps instalados com vencimento, cupons elegíveis, observações e linha do tempo de eventos (`client_events`). Reaproveita os mesmos dois modais pesados da lista.

## De onde vêm os dados

| Ação | Fonte |
|---|---|
| Listar (paginado) | RPC `get_clients_list_page` — filtro + busca + ordenação + paginação num único round-trip; escopa o tenant via `auth.uid()` internamente, sem receber `tenant_id` como parâmetro (não dá pra falsificar tenant pelo client) |
| Dropdowns da lista | `servers`; RPC `get_client_plan_periods`; RPC `get_client_used_apps`; `apps`; `app_integrations` |
| Editar cliente (fora da página carregada) | views `vw_clients_list_active` / `vw_clients_list_archived` |
| Criar cliente/teste | RPC `create_client_and_setup` |
| Editar cliente | RPC `update_client` + patch direto em `clients` (m3u_url/created_at) |
| Apps do cliente | `client_apps` — apagado e reinserido por inteiro a cada "Salvar" |
| Renovar/converter | RPC `update_client` + RPC `renew_client_and_log` |
| Arquivar/restaurar | RPC `update_client` (`p_is_archived`) |
| Excluir definitivo | RPC `delete_client_forever` — limpa 18 tabelas filhas antes do delete |
| Ficha: dados do cliente | views `vw_clients_list_*` + tabela `clients` (fonte da verdade de notes/plan_table_id/m3u_url/secundário) |
| Ficha: timeline | `client_events` |
| Ficha: cupons elegíveis | `/api/admin/clients/[id]/eligible-coupons` → `lib/client-portal/coupons.ts` |

## Rotas de API chamadas

- `POST /api/whatsapp/envio_agora` / `envio_programado` / `envio_simulado` — envio imediato/agendado/simulado, resolvendo variáveis (`{dns_servidor}`, `{tabela_precos}`, `{pendencia_detalhe}`, `{cupom_frase}`, `{link_pagamento}`), com log em `client_message_jobs`.
- `POST /api/whatsapp/validate`, `GET /api/whatsapp/profile[2]` — checagem de número/status de sessão.
- `POST /api/whatsapp/contact-photo` — foto do WhatsApp → `google_contacts`.
- `POST /api/admin/apps/configure` / `remove` / `check-validity` — orquestração de app do cliente (`lib/apps/orchestration.ts`), via `requireAdminTenant`.
- `POST /api/integrations/elite/sync` — `get_credentials` (credenciais reais do painel Elite pro browser) e `save_sync` (grava saldo).
- `POST /api/integrations/{fast,natv}/{create-trial,renew-client,sync}` — chamadas diretas às APIs dos painéis Fast/NaTV.
- `POST /api/auth/google/*` — sincronização de agenda Google.
- `POST /api/admin/coupons/redeem-manual` — grava resgate de cupom quando a renovação é concluída manualmente (idempotente por `payment_id`).
- `GET /api/admin/clients/[id]/eligible-coupons` — cupons elegíveis do cliente.

## Integrações externas

- **Painéis IPTV**: ELITE (via extensão Chrome no navegador do admin — o painel bloqueia scraping direto por Cloudflare Turnstile), FAST e NaTV (API REST direta, server-side).
- **Apps do cliente**: GERENCIAAPP, DUPLECAST, IBOPRO, DUPLEXTV, ClouDDy (todos via extensão/API própria).
- **WhatsApp** (VM própria, 2 sessões), **Google Contacts** (agenda + foto + operadora via Telein).
- Nenhum gateway de pagamento é acionado direto desta tela — pagamento é registrado manualmente (`renew_client_and_log`) ou chega pronto do Portal do Cliente via `client_portal_payments`.

## Achados que ficam para confirmação (não alterados)

1. **Criação de teste via Elite não tem timeout de segurança.** Em `novo_cliente.tsx`, o fluxo `ELITE_CREATE_TRIAL` espera a resposta da extensão do navegador sem nenhum timeout — se a extensão não estiver instalada/conectada/com a aba em foco, o modal fica preso em "Criando teste via Extensão..." indefinidamente. O fluxo gêmeo de **renovação** (`recarga_cliente.tsx`) já tem um timeout de 95s para esse mesmo cenário. Cheguei a replicar esse padrão aqui, mas revertido a pedido do Márcio — o fluxo depende inteiramente do tempo real da extensão no navegador, e um timeout fixo arriscaria cortar uma operação legítima ainda em andamento. Fica registrado como comportamento atual, não como bug a corrigir sem mais contexto.
2. **Seleção em massa na lista não faz nada.** Existem checkboxes por linha e "selecionar tudo" funcionando (estado mantido corretamente), mas nenhuma barra de ação em massa consome essa seleção — hoje marcar clientes não dispara nenhuma ação. Preciso confirmar se era para ter uma ação em lote (arquivar/mensagem em massa) que ficou pela metade, ou se o checkbox deveria ser removido.
3. **`delete_client_forever` pode não cobrir `client_portal_payments`.** O script que limpa as tabelas filhas antes de excluir um cliente definitivamente (`docs/sql/fix_delete_client_forever_missing_fk_cleanup.sql`, que já corrigiu 13 tabelas nessa situação) não menciona `client_portal_payments`. Se essa tabela tiver FK sem `ON DELETE CASCADE/SET NULL`, excluir definitivamente um cliente que já pagou pelo Portal pode falhar com o mesmo sintoma já visto antes. Precisa checagem direta no schema do Supabase antes de mexer.
4. **Credencial real do painel Elite trafega em claro pro navegador do admin** (`/api/integrations/elite/sync`, ação `get_credentials`) — decisão de arquitetura deliberada (a extensão precisa logar numa aba real porque o Cloudflare Turnstile barra automação server-side), não um bug, mas registro de que qualquer um com acesso ao DevTools de uma sessão admin ativa consegue ler a senha do painel Elite.
5. **RPCs mais críticas (`update_client`, `create_client_and_setup`, `renew_client_and_log`) não têm o `CREATE FUNCTION` versionado em `docs/sql/`** — só aparecem em scripts de correção pontuais. Não dá pra confirmar pelo repositório se têm a mesma trava de tenant (`SECURITY DEFINER` guardado) que as 15 funções já corrigidas em `fix_unguarded_security_definer_functions.sql`. Sugestão de processo: exportar a definição atual dessas 3 funções do Supabase pro repo.

## Confirmado sem bug

- Os filtros que o Dashboard linka (`?filter=ativos|vencidos|venceu_2_dias|venceu_ontem|vence_hoje|vence_amanha|vence_2_dias`) batem exatamente com o que a lista de clientes espera — sem divergência.

## Sugestões de melhoria (não-críticas, não alteradas)

- `client_apps` é sempre apagado e reinserido por inteiro a cada "Salvar", mesmo quando só a aba Dados/Servidor foi tocada — funciona, mas é mais escrita no banco do que o necessário.
- Um padrão de `setTimeout(resolve, 50-100ms)` antes de um segundo `.update()` logo após `update_client`/`create_client_and_setup` (em `novo_cliente.tsx`) sugere uma corrida de replicação encontrada no passado — funciona, mas é frágil sob carga.

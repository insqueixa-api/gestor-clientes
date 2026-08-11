# Tela: Testes (`/admin/teste`)

Arquivo: [app/admin/teste/page.tsx](../../app/admin/teste/page.tsx)

## O que é

Lista de "Testes" (trials) — **não é uma tabela separada**: são clientes com `clients.is_trial = true`, na mesma tabela usada pela tela de [Clientes](clientes.md). Reaproveita 100% os mesmos modais: `NovoCliente` (`mode="trial"`) para criar/editar, e `RecargaCliente` (`allowConvertWithoutPayment`) para "converter" um teste em cliente pagante. A conversão não cria uma linha nova — é um `UPDATE` na mesma linha via RPC `update_client`, setando `is_trial: false` (opcionalmente já registrando um pagamento/renovação junto, se o toggle "Registrar Pagamento?" estiver ligado, que é o padrão).

## De onde vêm os dados

- Listagem (paginada/filtrada/ordenada no banco): RPC `get_trials_list_page` (`docs/sql/add_trials_list_page_rpc.sql`) — lê `clients WHERE is_trial = true`, com joins em `servers`, `plan_tables`, subselects de apps e alertas.
- Dropdowns de filtro: RPCs `get_trial_plan_periods`, `get_trial_used_apps`, mais `servers`.
- Edição de item fora da página carregada: views `vw_trials_list_active`/`vw_trials_list_archived`.
- Modal "Papa Testes" (histórico): tabela `papa_testes`.
- `apps`, `app_integrations`, `message_templates`, `client_message_jobs` — apoio (badges, mensagens agendadas).

## Rotas de API chamadas

`/api/whatsapp/envio_agora`, `envio_simulado`, `envio_programado` — mesmas rotas de Clientes. Não há rota própria de "criar/editar/converter teste" — tudo via RPC direto do client dentro dos modais compartilhados (`create_client_and_setup`, `update_client`, `renew_client_and_log`, `delete_client_forever`, entre outras).

## Integrações externas

Nenhuma própria desta tela — as integrações reais (GerenciaApp, DupleCast etc.) acontecem dentro do modal `NovoCliente` compartilhado, disparadas na criação/edição do teste.

## Modais/componentes filhos

- `NovoCliente` e `RecargaCliente` (compartilhados com [Clientes](clientes.md)).
- `components/alerts/ClientAlertBell.tsx` — sino de alertas.
- `PapaTestesModal` (definido no próprio arquivo) — histórico de todos os testes/clientes já cadastrados.

## Achados (não alterados)

1. **Coluna "Convertido" sempre mostra "NÃO" — bug pré-existente, já documentado como fora de escopo no próprio SQL da migração.** `get_trials_list_page` nunca retorna `converted_client_id` (o próprio comentário da migração admite: "a badge 'Convertido' já sempre mostra 'NÃO' hoje — bug pré-existente, fora do escopo desta migração"). O botão "Criar cliente" (`disabled={r.converted}`) nunca fica travado por já ter sido convertido — mas na prática o teste some da lista assim que é convertido (porque o filtro é `is_trial=true`), então o impacto real é baixo. Corrigir de verdade exigiria adicionar uma coluna/flag de conversão em `clients` e propagar na RPC — é uma mudança de schema que prefiro não fazer de passagem.
2. **Possível gap de segurança não confirmado: `vw_trials_list_active`/`vw_trials_list_archived` (usadas na edição fora da página) selecionam `server_password` e dados de WhatsApp.** Essas duas views não aparecem na lista de views já corrigidas em `docs/sql/fix_security_definer_views.sql` (que tratou `vw_servers_active/archived`, `vw_epg_config`, `vw_catalog_*` por rodarem como "security definer" e vazarem dados entre tenants — um vazamento crítico já documentado no histórico deste projeto). Não consigo confirmar sem acesso direto ao Supabase se `vw_trials_list_*` têm `security_invoker=true` aplicado. **Recomendo fortemente verificar isso diretamente no painel do Supabase** (`SELECT * FROM pg_views WHERE viewname LIKE 'vw_trials_list%'` ou checar a flag na definição da view) — dado o padrão de vazamento já visto uma vez neste projeto, vale a prioridade.

## Sugestões de melhoria

- Levar `papa_testes` para paginação real no banco (RPC dedicada) — hoje carrega a tabela inteira do tenant no client, diferente da lista principal de Testes que já foi migrada para paginação real.
- Adicionar uma coluna/flag real de conversão em `clients` (achado 1), se o histórico "quem converteu quando" for útil.

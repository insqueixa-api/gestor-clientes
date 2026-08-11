# Tela: Gerenciador de Cobrança (`/admin/gerenciador/cobranca`)

Arquivo: [app/admin/gerenciador/cobranca/page.tsx](../../app/admin/gerenciador/cobranca/page.tsx)

## O que é

Automações de cobrança via WhatsApp ("réguas" disparadas por dias antes/depois do vencimento ou cadastro). Permite criar regras com filtros (status, servidor, plano, apps, sessão WhatsApp), rodar manualmente ("Enfileirar agora") ou automaticamente (motor no banco), monitorar/pausar/cancelar a fila global de mensagens, e configurar a "janela de disparo compartilhada" (horário sorteado + intervalo entre envios, anti-detecção de robô no WhatsApp).

## De onde vêm os dados

- **`billing_automations`** — CRUD das regras (join com `message_templates`).
- **`vw_clients_list_active`** — clientes com `apps_names`, vencimento, status, usada para calcular "Afetados Hoje".
- **`message_templates`**, **`message_template_variants`** — texto e variantes anti-detecção.
- **`servers`**, **`apps`** — filtros.
- **`billing_campaign_settings`** — 1 registro por tenant, janela de início/intervalo entre envios/dias ativos.
- **`client_message_jobs`** — fila de envio; inserida direto pelo client no "Envio Manual", e pelo motor de banco (`billing_enqueue_scheduled`) para as regras automáticas.
- **`vw_client_message_jobs_queue_details`** — monitor da fila global (polling a cada 30s).
- RPC `billing_control_automation` — PLAY/PAUSE/STOP de uma regra.

Não há rota de API própria para salvar/disparar automações — tudo é `insert`/`update`/`upsert`/`rpc` direto do client contra o Supabase (protegido por RLS).

## Rotas de API chamadas

- `GET /api/whatsapp/profile` / `profile2` — status das 2 sessões WhatsApp, só para rotular a sessão nos cards.

## Integrações externas

WhatsApp (VM própria), Supabase.

## Modais/componentes filhos

Todos no mesmo arquivo: `GlobalQueueMonitor`, `CampaignWindowCard`, `AutomationCard`, `ImpactListModal`, `AutomationWizard`, `MultiSelectDropdown`.

## Achados que precisam de decisão do usuário antes de corrigir (envolvem cobrança/receita)

1. **CRÍTICO — filtro "Aplicativos" de uma regra de cobrança nunca funciona.** O wizard salva o **UUID** do app selecionado em `billing_automations.target_apps`. Só que tanto o cálculo de impacto no front quanto o motor de produção (5 versões da função SQL de enqueue, todas em `docs/sql/`: `billing_enqueue_scheduled_campaign_window.sql`, `fix_billing_enqueue_anchor_and_secondary_delay.sql`, `fix_billing_enqueue_trigger_window.sql`, `fix_billing_lateral_random_cache.sql`, `billing_enqueue_scheduled_variants.sql`) comparam esse UUID contra `apps_names` — que são **nomes**, não UUIDs. A comparação nunca bate. **Efeito prático: qualquer regra de cobrança com filtro de "Aplicativos" específico mostra 0 clientes afetados e nunca enfileira mensagem nenhuma, automática ou manualmente, sem erro visível.** É a régua de cobrança ficando "morta em silêncio" sempre que segmentada por app — perda de cobrança real. **Não corrigi porque a correção envolve mudar tanto o front quanto recriar a função SQL de enqueue em produção (motor de cobrança automática já em uso) — quero sua confirmação antes de mexer nisso.** A correção em si é simples: salvar `label` (nome) em vez de `id` (UUID) no seletor de apps, ou trocar a comparação para IDs reais via `client_apps.app_id` nos dois lados (front e SQL).
2. **"Cancelar Tudo" pode não impedir a régua de voltar a enfileirar.** O botão cancela os jobs já visíveis na fila local, mas não força `execution_status` de regras `RUNNING`/`PAUSED` de volta a `IDLE` via `billing_control_automation`. Se uma regra automática estiver `RUNNING`, o admin pode achar que "matou" a fila e ela voltar a enfileirar no próximo ciclo do motor. Precisa confirmar o comportamento esperado do motor antes de mexer.

## Achado de baixo risco (não alterado)

3. O campo `delay_min` é sempre salvo com valor fixo `20`, apesar de o próprio comentário no código dizer que é legado e não é mais lido pelo motor (que hoje usa `billing_campaign_settings`). Não quebra nada, só ruído para quem for debugar via SQL.

# Tela: Gerenciador de Plano (`/admin/gerenciador/plano`)

Arquivos: [app/admin/gerenciador/plano/page.tsx](../../app/admin/gerenciador/plano/page.tsx) + [plano_modal.tsx](../../app/admin/gerenciador/plano/plano_modal.tsx)

## O que é

CRUD de "Tabelas de Preço" (planos IPTV) por moeda (BRL/EUR/USD), cada uma com 5 períodos (Mensal → Anual) × 3 quantidades de telas, definindo `credits_base` (créditos consumidos do servidor) e `price_amount` (preço cobrado do cliente) por célula.

## De onde vêm os dados

- **`plan_tables`** (`id, tenant_id, name, currency, is_active, is_system_default, table_type='iptv'`).
- **`plan_table_items`** — filho de `plan_tables` (período, meses, créditos).
- **`plan_table_item_prices`** — filho de `plan_table_items` (telas × preço).

CRUD 100% client-side via `supabaseBrowser`, inclusive o delete em cascata manual (preços → itens → tabela).

## Rotas de API chamadas

Nenhuma.

## Integrações externas

Nenhuma diretamente. `plan_table_item_prices` é a fonte de preço usada pelo `{tabela_precos}` dos templates de mensagem e pelo checkout do Portal do Cliente.

## Modais

`plano_modal.tsx` (`PlanoModal`) — cria/edita uma tabela inteira. Ao trocar a moeda de uma tabela existente, chama `cloneFromDefault()`, que **clona os valores da tabela padrão do sistema daquela moeda**, resetando os preços digitados (com aviso visual pequeno, não bloqueante).

## Comportamento confirmado correto (não é bug)

1. **Trocar a moeda de uma tabela existente reseta os preços digitados para os valores padrão do sistema daquela moeda.** Confirmado com o Márcio: esse reset é o comportamento **desejado** — o preço deve ser resetado quando a tabela (moeda) muda, e nunca deve mudar sem a tabela ser tocada. Não é um bug e não precisa de confirmação bloqueante extra.

## Achado que fica para confirmação (não alterado)

2. O `delete` de tabela usa uma condição `.or(tenant_id.eq.X, is_system_default.eq.true)` que, à primeira vista, pareceria permitir apagar uma tabela `is_system_default` de outro tenant — mas confirmei na RLS real (`docs/sql/allow_rename_delete_default_plan_tables.sql`) que a política de banco exige `tenant_id` bater independente dessa condição, então **não há vulnerabilidade ativa**, só uma condição client-side confusa/redundante (resíduo de um modelo de permissão anterior). Como toca a query de exclusão de preços, prefiro simplificar isso só depois de confirmar que não há nenhum caso legítimo de tabela `is_system_default` compartilhada entre tenants hoje.

## Sugestão de melhoria (não alterada)

- Salvar preços faz um loop sequencial de `update` por item/tela (até 15 chamadas seriais) em vez de um `upsert` em lote — funciona, mas deixa o "Salvar" mais lento do que precisaria.

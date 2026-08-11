# Tela: Dashboard (`/admin`)

Arquivo principal: [app/admin/page.tsx](../../app/admin/page.tsx)
Componentes auxiliares: [app/admin/dashboard-filter.tsx](../../app/admin/dashboard-filter.tsx), [components/ui/eye-toggle.tsx](../../components/ui/eye-toggle.tsx), [components/charts/simplebarchart.tsx](../../components/charts/simplebarchart.tsx), [components/charts/ranking-card.tsx](../../components/charts/ranking-card.tsx), [components/charts/evolucao-chart.tsx](../../components/charts/evolucao-chart.tsx)

## O que é

Página inicial do admin (Server Component, `dynamic = "force-dynamic"` — sempre renderiza no servidor a cada acesso, sem cache). Mostra dois "módulos" de indicadores: **IPTV** (clientes, vencimentos, faturamento do negócio de IPTV) e **Financeiro** (controle financeiro pessoal do dono, separado do dinheiro de cliente). Um filtro no topo (`DashboardFilter`) permite ver os dois juntos (padrão, sem `?view=` na URL) ou isolar um dos dois via `?view=iptv` ou `?view=financeiro`.

## De onde vêm os dados

A página não faz múltiplas queries soltas — chama **2 RPCs em paralelo** (`Promise.all`), cada uma devolvendo um único JSON já agregado:

- `get_dashboard_iptv_bundle()` — agrega 7 views + 1 tabela, tudo já filtrado pelo tenant via `auth.uid()` internamente (não usa `SECURITY DEFINER`, roda com o RLS do usuário logado):
  - `vw_dashboard_kpis_current_month` → clientes ativos, MRR estimado, vencidos, valor vencido, testes criados/ativos/convertidos no mês
  - `vw_dashboard_finance_cards` → recebido hoje/mês/mês anterior (clientes e revenda), a receber
  - `vw_dashboard_due_5_days` → quantidade e valor de vencimentos por `day_offset` (-2 a +2 dias)
  - `vw_dashboard_new_registrations_daily_current_month` → série diária de cadastros (clientes vs. testes)
  - `vw_dashboard_payments_daily_current_month` → série diária de pagamentos (clientes vs. revenda)
  - `vw_dashboard_top_servers_current_month` / `vw_dashboard_top_apps_current_month` → top 5 servidores/apps por clientes criados no mês
  - `server_credit_purchases` (tabela) → despesas com recarga de crédito de servidor (mês atual e anterior), usadas para calcular "Lucro" (faturamento − despesas)
- `get_dashboard_finance_bundle()` — financeiro pessoal, também sem `SECURITY DEFINER`:
  - `fin_categorias`, `fin_transacoes` (mês atual), `fin_previsao_snapshot` (mês atual)
  - `evolucao_transacoes`/`evolucao_snapshot` — mesmas tabelas, mas janela de 12 meses, usadas só pelo card "Evolução Consolidada"
  - `saldo_atual` — soma agregada de todas as `fin_contas_bancarias` (saldo inicial + receitas pagas − despesas pagas), calculada dentro da própria função (substituiu um N+1 antigo que chamava uma RPC por conta)

Ver [docs/sql/add_dashboard_bundle_rpcs.sql](../sql/add_dashboard_bundle_rpcs.sql) — essas duas funções existem justamente para eliminar ~12 idas ao banco em ondas sequenciais que a página fazia antes (histórico de otimização, comentado no próprio SQL).

## Lógica de "Previsto congelado" vs. "Ajustes" vs. "Executado"

A parte mais complexa da página é o bloco **Controle Financeiro** (só visível quando o módulo `financeiro` está ativo):

- **Previsto**: não é recalculado ao vivo — vem de uma "fotografia" (`fin_previsao_snapshot`) tirada na virada do mês (ver rota `app/api/finance/snapshot-previsao`). Isso existe para o número de "previsão do mês" não mudar toda vez que uma transação nova é lançada durante o mês.
- **Ajustes**: transações que passaram a existir *depois* da fotografia (conta nova, receita não programada) e o delta do "a receber" de IPTV que cresceu desde o snapshot. Aparecem como um "+ Ajustes" separado, em âmbar.
- **Executado**: sempre ao vivo (o que já foi de fato pago), nunca depende do snapshot.
- A categoria "IPTV" (identificada por nome contendo "iptv", case-insensitive) é tratada à parte em Ajustes/Executado para não contar dinheiro em dobro — o lançamento sincronizado automaticamente pela tela Financeiro Pessoal (`IPTV - Rendimentos`/`IPTV - Recarga de Servidores`) já é "dinheiro conhecido", não uma novidade.
- Se o mês não tem fotografia ainda (mês muito antigo, anterior à existência dessa feature), cai num fallback que recalcula tudo ao vivo, como era antes.

Isso é lógica genuinamente delicada — qualquer alteração aqui exige testar os 3 números (Previsto, Ajustes, Executado) batendo com o snapshot real.

## Filtro de módulos (`DashboardFilter`)

Client Component simples: dois botões (IPTV 📺 / Financeiro 📊) que fazem `router.push(pathname + "?view=" + key)`. Cada clique troca para **um único módulo** — não existe um terceiro botão "Ambos" no próprio filtro; para voltar a ver os dois juntos é preciso navegar para `/admin` sem query string (ex.: clicando no link do menu lateral). Funcional, mas é uma pequena lacuna de UX: dentro do próprio widget de filtro não há como voltar ao estado combinado sem sair da página. Não alterei isso por ser uma decisão de produto (pode ser proposital), mas fica registrado como sugestão de melhoria.

## Outros elementos

- **EyeToggle** (`components/ui/eye-toggle.tsx`): botão "Ocultar/Exibir" que apenas seta um atributo `data-values-hidden` no container `#dashboard-values` (controle puramente visual via CSS, não desmonta nem busca dados de novo).
- **Cards de métrica com `href`** (`MetricCardView`) abrem em **nova aba** (`target="_blank"`) ao invés de navegar na mesma aba — ex.: clicar em "Ativos" abre `/admin/cliente?filter=ativos` numa aba nova. Parece intencional (não perder o dashboard ao investigar um filtro), mas convém confirmar que é o comportamento desejado, já que múltiplos cliques acumulam várias abas.
- Gráficos (`SimpleBarChart`, `RankingCard`, `EvolucaoFinanceira`) são todos puramente apresentacionais — recebem os dados já prontos via props, não buscam nada por conta própria (isso também foi parte da otimização registrada no SQL acima: antes, `EvolucaoFinanceira` fazia 2 queries próprias).

## Integrações externas

Nenhuma integração de terceiros diretamente nesta tela — é 100% dados internos (Supabase). As integrações (WhatsApp, gateways de pagamento) aparecem indiretamente nos números (ex.: pagamentos recebidos via Mercado Pago/Stripe entram nas views de faturamento), mas a página não chama essas APIs.

## Achados da análise

Nenhum bug funcional encontrado nesta tela. Código bem comentado, com histórico de decisões preservado inline (útil, incomum de ver). Dois pontos de observação (não alterados, são decisões de produto):

1. Filtro de módulo não tem opção "Ambos" dentro do próprio widget (só via navegação limpa para `/admin`).
2. Cards com link abrem em nova aba (`target="_blank"`) — confirmar se é o comportamento desejado.

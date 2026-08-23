# Tela: Settings › Financeiro Pessoal (`/admin/settings/financeiro_pessoal`)

Arquivo: [app/admin/settings/financeiro_pessoal/page.tsx](../../app/admin/settings/financeiro_pessoal/page.tsx)

## O que é

Controle financeiro **pessoal** do dono (não é a contabilidade dos clientes IPTV — é dinheiro dele). Permite lançar receitas/despesas (únicas, recorrentes ou parceladas), dar baixa/reverter pagamento, ajustar saldo de conta manualmente, e gerenciar contas bancárias/categorias com ícone. É a origem de todas as tabelas `fin_*` já documentadas em [dashboard.md](dashboard.md) (`fin_transacoes`, `fin_categorias`, `fin_contas_bancarias`, `fin_previsao_snapshot`).

A cada carregamento do mês, sincroniza automaticamente 2 lançamentos "espelho" do Dashboard IPTV direto em `fin_transacoes`: **"IPTV - Rendimentos"** e **"IPTV - Recarga de Servidores"**.

Também tem uma feature de **Empréstimos informais** (dinheiro emprestado sem data/valor de devolução combinado, pago aos poucos): botão "🤝 Empréstimos" ao lado de "+ Adicionar Lançamento" abre o `ModalEmprestimos`, que lista pessoas (`fin_emprestimos`) com o saldo devedor calculado ao vivo a partir de `fin_transacoes.emprestimo_id` (soma de DESPESA pagas menos RECEITA pagas daquela pessoa). "+ Emprestei"/"+ Recebi pagamento" abrem o `ModalTransacao` de sempre, só que pré-preenchido (tipo, descrição, categoria "Empréstimos", status já `PAGO` com data de hoje — sem vencimento futuro, por isso nunca aparece como "vencido"). A categoria "Empréstimos" (🤝, tipo AMBOS) é criada automaticamente por essa tela na primeira vez que falta.

## De onde vêm os dados

- **`fin_transacoes`** — CRUD completo, com joins em `fin_contas_bancarias`/`fin_categorias`. Tem coluna opcional `emprestimo_id` (fk `fin_emprestimos`) pra marcar lançamentos de empréstimo.
- **`fin_contas_bancarias`**, **`fin_categorias`** — CRUD completo.
- **`fin_emprestimos`** — CRUD completo (pessoa + saldo calculado em memória, não fica em coluna). Schema em `docs/sql/loans.sql`.
- **`vw_dashboard_finance_cards`**, **`server_credit_purchases`** — só leitura, para a sincronização automática dos 2 lançamentos de IPTV.
- RPC `get_saldo_conta(p_conta_id)` — chamada **em loop, uma vez por conta**.
- RPC `resolve_notification` — resolve notificação de vencimento ao pagar/editar/excluir um lançamento.
- **`fin_previsao_snapshot` não é lida nem escrita por esta tela** — só pelo Dashboard e pela rota `app/api/finance/snapshot-previsao` (cron). Por isso o número de "Previsão" mostrado aqui (recalculado ao vivo) pode divergir do "Previsto" do Dashboard (uma fotografia congelada da virada do mês) — isso é esperado, não é bug.

## Rotas de API chamadas

Nenhuma — toda a persistência é direto via `supabaseBrowser`.

## Modais

`ModalTransacao`, `ModalBaixa` (confirmar/reverter pagamento), `ModalAjusteSaldo`, `ModalNovaConta`, `ModalNovaCategoria`, `ModalGerenciarItens`, `ModalEmprestimos` (lista de pessoas + histórico + saldo devedor), seletores de data reutilizados, e um modal de exclusão de lançamento recorrente ("só esta" vs. "esta e futuras").

## Achados que ficam para confirmação/observação (não alterados)

1. **N+1 de RPC (`get_saldo_conta` em loop) — o mesmo padrão que já foi eliminado no Dashboard.** O comentário em `docs/sql/add_dashboard_bundle_rpcs.sql` documenta esse exato problema de performance como já corrigido no Dashboard (substituído por uma soma agregada única), mas a correção não foi replicada nesta tela. Não corrigi porque a correção "de verdade" exigiria escrever uma nova RPC agregada no banco — prefiro fazer isso como uma mudança dedicada, não de passagem.
2. **Sincronização automática de IPTV depende de existir uma categoria com "iptv" no nome, sem aviso se sumir.** Se a única categoria com "iptv" no nome for renomeada ou excluída (a tela permite excluir categorias livremente), a sincronização dos 2 lançamentos automáticos para de funcionar **silenciosamente** — os cards de Receita/Despesa do mês ficam sem esses valores e ninguém é avisado. Envolve dinheiro (composição do relatório financeiro), então prefiro que você decida entre travar a exclusão dessa categoria ou adicionar um aviso, em vez de eu escolher por conta própria.
3. Lançamentos sincronizados de IPTV sempre têm `conta_id: null` (proposital — são valores agregados, não amarrados a uma conta específica), o que pode significar que eles não entram no cálculo de "Saldo Atual" por conta. Não consegui confirmar o SQL de `get_saldo_conta` (não está em `docs/sql/`) para verificar o efeito exato — vale confirmar se esse comportamento é o esperado.

## Sugestões de melhoria

- Substituir o loop de `get_saldo_conta` por uma RPC agregada única, no mesmo espírito da correção já feita no Dashboard.
- Considerar um `categoria_iptv_id` fixo/configurável em vez de match por substring no nome (achado 2).

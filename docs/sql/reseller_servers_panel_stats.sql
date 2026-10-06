-- docs/sql/reseller_servers_panel_stats.sql
-- 06/10/2026 — botão "Sync" do servidor vinculado à revenda (página da revenda):
-- guarda o último resumo puxado do painel (créditos, clientes ativos/expirados,
-- vencendo em 2 dias). O relatório do NaTV (/report/allusers) só pode ser
-- chamado 1x por minuto, então a tela mostra o último resumo salvo e o Sync
-- atualiza. Só agregado + login/vencimento de quem vence — nunca senha.
alter table public.reseller_servers
  add column if not exists panel_stats jsonb,
  add column if not exists panel_stats_at timestamptz;

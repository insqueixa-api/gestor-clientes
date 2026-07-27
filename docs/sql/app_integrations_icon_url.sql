-- docs/sql/app_integrations_icon_url.sql
-- Logo manual pra integração de aplicativo, usada só quando NENHUM app do
-- catálogo bate 1:1 com o handler (ex: GERENCIAAPP cobre 7 apps diferentes,
-- cada um com sua própria logo — nesse caso não tem logo "certa" pra herdar,
-- então o admin sobe uma pela tela de Integrações mesmo).
alter table public.app_integrations
  add column if not exists icon_url text;

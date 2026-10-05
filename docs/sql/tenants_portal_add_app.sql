-- docs/sql/tenants_portal_add_app.sql
-- ✅ 04/10/2026, pedido do Márcio: "Adicionar aplicativo" do portal
-- controlado pelo admin (página Aplicativos, chave Portal ativo/inativo).
--   portal_add_app_enabled = true  → todos os clientes veem o botão
--   portal_add_app_enabled = false → só os WhatsApp de teste (portal_app_testers)
-- Os testers também não têm o limite de 5 apps por conta.
alter table public.tenants add column if not exists portal_add_app_enabled boolean not null default false;
alter table public.tenants add column if not exists portal_app_testers text[] not null default '{}';
update public.tenants set portal_app_testers = array['5521998045693']
 where id = 'a5ab0672-c845-4c40-96b9-eeed197e04ed' and not ('5521998045693' = any(portal_app_testers));

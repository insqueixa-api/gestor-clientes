-- Ninja Plus (quickplayer.life) — 29/08/2026. O catálogo "Ninja Plus" já
-- tinha esse nome, mas apontava pro integration_type NINJAPLAYER (backend
-- Laravel de meta-player.app) — errado. O app real por trás desse nome no
-- catálogo do Márcio usa outro domínio da família QuickPlayer
-- (/api/public/customer/*), confirmado ao vivo com MAC/device real antes
-- deste arquivo (ver app/api/integrations/apps/ninjaplus/route.ts).
-- Só 1 cliente usava esse app até agora — baixo risco.

update public.apps
set integration_type = 'NINJAPLUS'
where integration_type = 'NINJAPLAYER';

-- PIN + link do painel, mesmo padrão do QUICKPLAYER (app_integrations.pin
-- lido server-side pela rota, nunca exposto no client_apps.field_values).
-- Sem constraint única em app_name (só PK em id) — upsert manual em vez de
-- ON CONFLICT.
do $$
declare
  v_tenant_id uuid;
begin
  -- app_integrations.tenant_id é NOT NULL — reaproveita o mesmo tenant já
  -- usado pela config do QUICKPLAYER (sistema é single-tenant hoje).
  select tenant_id into v_tenant_id from public.app_integrations where app_name = 'QUICKPLAYER' limit 1;

  if exists (select 1 from public.app_integrations where app_name = 'NINJAPLUS') then
    update public.app_integrations
    set is_active = true, pin = '300783', api_url = 'https://quickplayer.life', label = 'Ninja Plus'
    where app_name = 'NINJAPLUS';
  else
    insert into public.app_integrations (tenant_id, app_name, label, is_active, pin, api_url)
    values (v_tenant_id, 'NINJAPLUS', 'Ninja Plus', true, '300783', 'https://quickplayer.life');
  end if;
end $$;

-- Config antiga do NINJAPLAYER não serve mais pra nada (nenhum app aponta
-- mais pra ela) — desativa em vez de apagar, só por precaução.
update public.app_integrations
set is_active = false
where app_name = 'NINJAPLAYER';

-- Conferir depois de rodar:
--   select id, name, integration_type from apps where name ilike '%ninja%';
--   select app_name, is_active, api_url from app_integrations where app_name in ('NINJAPLUS','NINJAPLAYER');

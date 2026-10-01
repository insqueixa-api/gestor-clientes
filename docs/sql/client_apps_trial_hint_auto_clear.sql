-- =====================================================================
-- 30/09/2026 — "Modo de avaliação" sai sozinho quando o vencimento muda
-- =====================================================================
-- Pedido do Márcio: app em trial (ex: DUPLECAST — "Expire on" vazio no
-- site deles) mostra "Modo de avaliação" no lugar da data e libera a
-- renovação no portal. A marca fica em client_apps.field_values._trial_hint
-- (gravada por lib/apps/orchestration.ts na consulta ao parceiro).
--
-- 13 caminhos gravam o vencimento (Appativa, Duplecast por código, GPC
-- Roku, GerenciaApp, fulfillment, watchdog, edição pelo cliente…) — em vez
-- de lembrar de limpar a marca em cada um, esta trigger limpa sempre que a
-- data do campo "date" do app MUDA pra um valor não vazio. A consulta que
-- só confirma o trial (data igual) mantém a marca.
create or replace function public._client_apps_clear_trial_on_date_change()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_key text;
begin
  if not (new.field_values ? '_trial_hint') then
    return new;
  end if;

  select coalesce(f->>'id', f->>'label')
    into v_key
  from public.apps a,
       jsonb_array_elements(coalesce(a.fields_config, '[]'::jsonb)) f
  where a.id = new.app_id
    and lower(f->>'type') = 'date'
  limit 1;

  if v_key is not null
     and coalesce(new.field_values->>v_key, '') <> ''
     and (new.field_values->>v_key) is distinct from (old.field_values->>v_key) then
    new.field_values := new.field_values - '_trial_hint';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_client_apps_clear_trial_on_date_change on public.client_apps;
create trigger trg_client_apps_clear_trial_on_date_change
before update of field_values on public.client_apps
for each row execute function public._client_apps_clear_trial_on_date_change();

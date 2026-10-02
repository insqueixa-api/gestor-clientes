-- =====================================================================
-- 02/10/2026 — Ambiente (campo "obs" dos apps) sempre com 1ª letra maiúscula
-- =====================================================================
-- Pedido do Márcio: admin ou portal, quem digitar "sala"/"celular" grava
-- "Sala"/"Celular". Trigger no banco pra valer em TODO caminho de gravação
-- (novo_cliente, portal, rotas de API) sem depender de cada tela.
-- Regra: tira espaços das pontas e duplicados, 1ª letra maiúscula e o RESTO
-- COMO FOI DIGITADO — "celular Erick" → "Celular Erick"; não rebaixa o resto
-- pra não estragar nome próprio/sigla ("Notebook Hugo", "TV", "S24").
-- O campo é achado pelo apps.fields_config (type = 'obs') do app da linha.

create or replace function public.normalize_ambiente(v text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when v is null then null
    when btrim(regexp_replace(v, '\s+', ' ', 'g')) = '' then ''
    else upper(left(btrim(regexp_replace(v, '\s+', ' ', 'g')), 1))
         || substr(btrim(regexp_replace(v, '\s+', ' ', 'g')), 2)
  end
$$;

create or replace function public._client_apps_normalize_ambiente()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  f jsonb;
  fid text;
begin
  if new.field_values is null or jsonb_typeof(new.field_values) <> 'object' then
    return new;
  end if;
  for f in
    select jsonb_array_elements(a.fields_config)
    from public.apps a
    where a.id = new.app_id and jsonb_typeof(a.fields_config) = 'array'
  loop
    if f->>'type' = 'obs' then
      fid := f->>'id';
      if fid is not null and jsonb_typeof(new.field_values->fid) = 'string' then
        new.field_values := jsonb_set(
          new.field_values, array[fid],
          to_jsonb(public.normalize_ambiente(new.field_values->>fid))
        );
      end if;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_client_apps_normalize_ambiente on public.client_apps;
create trigger trg_client_apps_normalize_ambiente
  before insert or update of field_values, app_id on public.client_apps
  for each row execute function public._client_apps_normalize_ambiente();

-- Ajuste do que já está no banco (só linhas que mudam de verdade).
update public.client_apps ca
set field_values = ca.field_values
where exists (
  select 1
  from public.apps a, jsonb_array_elements(a.fields_config) f
  where a.id = ca.app_id
    and jsonb_typeof(a.fields_config) = 'array'
    and f->>'type' = 'obs'
    and jsonb_typeof(ca.field_values->(f->>'id')) = 'string'
    and ca.field_values->>(f->>'id') is distinct from public.normalize_ambiente(ca.field_values->>(f->>'id'))
);

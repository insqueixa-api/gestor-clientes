-- Pedido do Márcio: poder renomear, editar e apagar as tabelas de preço
-- "padrão do sistema" (Padrão BRL/USD/EUR) — hoje travadas por completo.
--
-- Achado: 3 camadas de proteção em plan_tables:
--   1) Trigger enforce_plan_table_system_defaults() — bloqueia DELETE e
--      renomear (nome preso a "Padrão BRL/USD/EUR" fixo) de qualquer linha
--      is_system_default=true.
--   2) RLS: policies delete_own_tenant_non_default e admin_delete_own_tenant
--      já exigiam is_system_default=false pra permitir DELETE.
--   3) Função can_delete_plan_table() (usada só como helper de UI) também
--      retornava false pra is_system_default=true.
--
-- Decisão (conversamos e o Márcio confirmou): renomear fica livre; apagar
-- fica livre EXCETO quando for a ÚLTIMA tabela daquela moeda pro tenant —
-- isso evita cliente do bot/portal ficar sem nenhuma tabela de preço pra
-- uma moeda (várias rotas buscam is_system_default=true + currency=X
-- esperando sempre achar uma linha). "Desativar" (is_active=false) e
-- remover a flag is_system_default continuam bloqueados — não foi pedido.

CREATE OR REPLACE FUNCTION public.enforce_plan_table_system_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
  declare
    v_bypass text;
    v_outras_na_moeda integer;
  begin
    v_bypass := current_setting('app.bypass_system_default_check', true);
    if v_bypass = 'on' then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;

    if old.is_system_default = true then

      if tg_op = 'DELETE' then
        select count(*) into v_outras_na_moeda
        from public.plan_tables pt
        where pt.tenant_id = old.tenant_id
          and pt.currency = old.currency
          and pt.id <> old.id;

        if v_outras_na_moeda = 0 then
          raise exception 'SYSTEM_DEFAULT_PLAN_TABLE_LAST_OF_CURRENCY:%', old.currency;
        end if;

        return old;
      end if;

      if new.is_active = false then
        raise exception 'SYSTEM_DEFAULT_PLAN_TABLE_CANNOT_BE_DISABLED';
      end if;

      if new.is_system_default = false then
        raise exception 'SYSTEM_DEFAULT_PLAN_TABLE_FLAG_CANNOT_BE_REMOVED';
      end if;

    end if;

    return new;
  end;
  $function$;

-- RLS: já não precisa mais barrar is_system_default aqui — a trigger acima
-- (que roda independente de qual policy liberou o acesso) já garante a
-- regra "não pode ser a última da moeda". Consolida as 2 policies de DELETE
-- redundantes numa só, sem a exigência de is_system_default=false.
DROP POLICY IF EXISTS delete_own_tenant_non_default ON public.plan_tables;
DROP POLICY IF EXISTS admin_delete_own_tenant ON public.plan_tables;

CREATE POLICY admin_delete_own_tenant ON public.plan_tables
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = plan_tables.tenant_id
        AND tm.user_id = auth.uid()
    )
  );

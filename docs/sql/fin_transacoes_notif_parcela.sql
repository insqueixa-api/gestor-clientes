-- ✅ 01/09/2026, pedido do Márcio: notificação de "Recebimento/Pagamento
-- Vencido" não dizia qual parcela era num lançamento parcelado (ex:
-- empréstimo/financiamento pago em várias vezes) — as colunas
-- parcela_atual/parcela_total já existem na fin_transacoes e já vêm
-- preenchidas certinho, só faltava usar no texto.
CREATE OR REPLACE FUNCTION public.check_overdue_transactions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rec record;
begin
  for rec in
    select id, tenant_id, descricao, valor, tipo, data_vencimento, parcela_atual, parcela_total
    from fin_transacoes
    where status = 'PENDENTE'
      and data_vencimento <= (now() at time zone 'America/Sao_Paulo')::date
  loop
    insert into notifications (tenant_id, type, title, message, link, source_id)
    values (
      rec.tenant_id,
      'fin_vencido',
      case when rec.tipo = 'RECEITA' then '🟧 Recebimento Vencido' else '🟥 Pagamento Vencido' end,
      rec.descricao || ' - R$ ' || to_char(rec.valor, 'FM999999990.00') ||
        case
          when rec.parcela_atual is not null and rec.parcela_total is not null
            then ' (parcela ' || rec.parcela_atual || '/' || rec.parcela_total || ')'
          else ''
        end ||
        '. Vencimento em ' || to_char(rec.data_vencimento, 'DD/MM/YYYY') || '.',
      '/admin/settings/financeiro_pessoal',
      rec.id::text
    )
    on conflict (tenant_id, type, source_id)
    do update set
      message = excluded.message,
      title = excluded.title,
      resolved_at = null,
      is_read = false;
  end loop;
end;
$function$;

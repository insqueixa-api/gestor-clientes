-- ✅ 16/10/2026, achado do Márcio: todo teste ganhava 2 linhas "Teste criado"
-- na linha do tempo — a do cadastro (novo_cliente.tsx, com servidor e
-- vencimento) e a deste gatilho antigo (só "Teste criado"). Todo teste hoje
-- nasce pelo cadastro, então o gatilho sai.
drop trigger if exists trg_clients_log_trial_created on public.clients;
drop function if exists public.log_trial_created_event();

-- limpa as duplicadas antigas: apaga a linha curta do gatilho só onde já
-- existe a completa do cadastro (testes de fevereiro que só têm a curta ficam)
delete from public.client_events e
 where e.event_type = 'TRIAL_CREATED'
   and e.message = 'Teste criado'
   and exists (
     select 1 from public.client_events f
      where f.client_id = e.client_id
        and f.event_type = 'TRIAL_CREATED'
        and f.message <> 'Teste criado'
   );

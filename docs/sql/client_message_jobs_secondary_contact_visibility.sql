-- ✅ 09/09/2026, bug real achado (Márcio: conta com contato primário+
-- secundário, ele perguntou se a Eliana tinha recebido — investigação
-- concluiu errado que não, baseada só na AUSÊNCIA de uma 2ª linha em
-- client_message_jobs; na real ela recebeu certinho, só não tinha NENHUM
-- registro consultável disso). client_message_jobs é 1 linha por CLIENTE
-- por dia (não por contato) — o loop de envio (app/api/whatsapp/
-- envio_programado/route.ts) manda pro primário E pro secundário quando a
-- conta tem os dois, mas só grava "SENT"/sent_at referente ao PRIMEIRO
-- contato que teve sucesso (checkpoint, ver comentário grande no arquivo).
-- O resultado do 2º contato (a maioria das vezes o secundário) nunca virava
-- registro nenhum — nem sucesso nem falha.
--
-- Estas 2 colunas guardam o resultado do contato secundário (quando
-- existir) ao lado do resultado do primário que a linha já representa —
-- sem precisar de uma tabela nova por enquanto (job continua 1 linha por
-- cliente/dia, só ganha mais 2 campos opcionais).
alter table public.client_message_jobs
  add column if not exists secondary_sent_at timestamptz,
  add column if not exists secondary_error_message text;

comment on column public.client_message_jobs.secondary_sent_at is
  'Quando o contato secundário da conta (se existir) recebeu esta mesma mensagem com sucesso. NULL = conta não tem secundário, ou o envio a ele ainda não foi tentado/terminou em erro (ver secondary_error_message).';
comment on column public.client_message_jobs.secondary_error_message is
  'Erro do envio ao contato secundário, se falhou. NULL + secondary_sent_at NULL = não tem secundário ou ainda não chegou a vez dele nesta linha.';

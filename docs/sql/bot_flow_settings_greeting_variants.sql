-- Variações da saudação inicial do bot (1ª mensagem, antes do menu) — mesma
-- estratégia anti-detecção já usada em message_template_variants (cobrança):
-- sortear entre o texto original e variantes cadastradas, em vez de mandar
-- sempre o mesmo texto pra todo mundo que chama o bot pela primeira vez.
-- Pedido do Márcio, 09/08/2026.
alter table public.bot_flow_settings
  add column if not exists greeting_message_variants text[] not null default '{}';

-- Nova mensagem configurável do fluxo do bot: resposta quando o cliente vem
-- transferido do Portal do Cliente (botão "Fale com o suporte" do Bloco 3,
-- app/renew-beta/RenewBetaClient.tsx). Mesmo padrão de human_requested_message.
alter table public.bot_flow_settings
  add column if not exists portal_handoff_message text;

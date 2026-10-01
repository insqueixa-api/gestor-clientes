// lib/apps/portal-apps-flag.ts
//
// ⏸️ Chave pra DESLIGAR "Meus Aplicativos" do portal (criada 30/09/2026,
// pedido do Márcio) enquanto o refactor de aplicativos acontece
// (docs/apps-refactor/PLANO.md) — pra nenhum cliente adicionar/remover/
// pagar licença avulsa/configurar app no meio da mudança.
//
// true = desligado, false = normal (padrão até o refactor começar). Afeta:
// - app/renew/RenewClient.tsx: card do menu vira "Em atualização" e a seção
//   "apps" não abre;
// - app/renew/apps/[id]/page.tsx: volta pro /renew;
// - rotas que ALTERAM dados em app/api/client-portal/apps/* (add, configure,
//   remove, renew-gerenciaapp, renew-payment, request-setup, update-fields)
//   respondem 503.
// NÃO afeta: rotas só de leitura, retry-activation (app já pago), a
// renovação de app embutida no pagamento do plano (create-payment) e nada
// do admin.
export const PORTAL_APPS_DISABLED = false;

export const PORTAL_APPS_DISABLED_MESSAGE =
  "Meus Aplicativos está em atualização e volta em breve. Se precisar de ajuda com um aplicativo agora, fale com o suporte.";

// ⏸️ Só o botão "+ Adicionar aplicativo" do portal (30/09/2026, pedido do
// Márcio) — esconde a entrada pra apps NOVOS até a vitrine nova
// (docs/apps-refactor/PLANO.md, fase 4). Reconfigurar, editar, renovar e
// remover os apps que o cliente já tem continuam normais. Religar = false.
export const PORTAL_ADD_APP_HIDDEN = true;

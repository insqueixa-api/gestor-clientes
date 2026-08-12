# Tela: Portal do Cliente (`/renew`)

Arquivos: [app/renew/page.tsx](../../app/renew/page.tsx) (só monta `ConfirmProvider` + `Suspense`), [app/renew/RenewClient.tsx](../../app/renew/RenewClient.tsx) (~5.500 linhas, toda a lógica), [app/renew/ConfigureResultModal.tsx](../../app/renew/ConfigureResultModal.tsx)

## O que é

Diferente do admin (Supabase Auth), o Portal é acessado pelos **clientes finais** da IPTV, autenticados por sessão própria (`client_portal_sessions`, token via `?session=` na URL — mandado pelo WhatsApp/bot — ou salvo em `sessionStorage`). Um mesmo login de WhatsApp pode ter várias contas/assinaturas vinculadas (`whatsapp_username` ou `secondary_whatsapp_username`); o cliente escolhe qual gerenciar.

> Desde 12/08/2026, `whatsapp_username` aceita telefone OU um username reservado do WhatsApp — todo o escopo de sessão/pagamento (`get-accounts`, `get-prices`, `create-payment`, `payment-status`, etc.) foi atualizado para continuar funcionando mesmo quando uma conta troca de identidade. Ver [Identidade híbrida no WhatsApp](portal-identidade-hibrida.md) para a arquitetura completa.

Três blocos:
1. **Pagamento/Renovação** — planos disponíveis, cupom de desconto, pendências financeiras, checkout (PIX/cartão/transferência manual), polling de status.
2. **Novidades/Conteúdo** — link para o [Guia de TV](portal-guia-tv.md).
3. **Meus Aplicativos (self-service)** — ver apps instalados, adicionar (limite 5/conta), editar campos, configurar/reconfigurar via integração automática, pedir configuração manual, renovar licença avulsa, remover.

## De onde vêm os dados

`client_portal_sessions`, `clients`, `client_apps`, `apps`, `client_app_requests`, `client_app_activity_log`, `client_portal_payments`, `payment_gateways`, `plan_tables`/`plan_table_items`/`plan_table_item_prices`, `coupons`/`coupon_redemptions`/`coupon_abuse_guard`, `servers`, `server_integrations`, RPC `portal_start_session`.

## Rotas de API chamadas (`app/api/client-portal/`)

| Rota | Escopo por client_id/sessão |
|---|---|
| `POST login` | N/A (é o login em si — RPC `portal_start_session` + Turnstile) |
| `POST validate-session` | sim |
| `POST get-accounts` | sim (`.or(whatsapp_username, secondary_whatsapp_username)`) |
| `POST get-prices` | sim |
| `POST create-payment` | sim + `checkCouponAbuseGuard` por `client_id` |
| `POST payment-status` | sim |
| `POST pending-charges` | sim |
| `POST validate-coupon` | sim |
| `POST apps/{list,catalog,detail,add,update-fields,configure,remove,renew-gerenciaapp,renew-payment,request-setup,check-validity}` | sim, via `validatePortalClient()` central (`lib/client-portal/session.ts`) |

Todas as rotas de apps passam pelo mesmo helper central de validação — não há rota que confie em `client_id` vindo do body sem confirmar contra a sessão.

## Integrações externas

**Mercado Pago** (PIX), **Stripe** (cartão internacional), **Cloudflare Turnstile** (anti-bot no login), painéis de parceiros de app (via `lib/apps/orchestration.ts`, protegidos por `x-internal-secret`), notificações internas ao admin (sino + e-mail de transferência manual).

## Modais/componentes filhos

- `ConfigureResultModal` — resultado de Configurar/Reconfigurar (sucesso/erro/bloqueio), reaproveitado também em `AppDetailClient.tsx`.
- `ReconfigureModeModal`, `AppPickerModal` (`components/apps/`).

## Achado que precisa de decisão (envolve dinheiro/negócio — não alterado)

1. **Contas arquivadas (`is_archived=true`) não são filtradas em nenhuma rota do Portal.** `get-accounts` e as demais rotas não checam `is_archived` — o campo é devolvido no payload e até tem um tipo `ClientAccount.is_archived` no front, mas nunca é lido para nada (sem badge, sem exclusão da lista, sem bloqueio no pagamento). Se uma conta arquivada continuar recebendo/reusando um link de portal válido, o cliente consegue renovar/pagar/adicionar apps nela normalmente — o que pode significar cobrar ou reativar self-service em algo que você já arquivou de propósito. Não consegui confirmar pelo repositório se a RPC `portal_start_session` (só existe no Supabase) já bloqueia isso no login. **Antes de eu adicionar o filtro, preciso saber**: contas arquivadas devem continuar acessíveis pelo portal (ex: para o cliente ver histórico) ou devem ser bloqueadas completamente?

## Achados de baixo risco (não alterados)

2. Label customizado de um campo de app diverge entre `apps/list` (prioriza o nome que o admin customizou) e `apps/detail`/`/renew/apps/[id]` (prioriza o nome padrão do tipo, com um comentário que afirma incorretamente ter "a mesma prioridade"). Se o admin renomeou um campo, a página de detalhe mostra o nome errado.
3. Campos tipo "password" de um app (ex: login do IPTV Smarters) aparecem em texto puro pro cliente, tanto em leitura quanto em edição — **isso é intencional e correto**, não é a senha da conta IPTV: é uma credencial que o próprio cliente já possui e precisa ler para digitar em outro app. A senha real da conta (`clients.server_password`) nunca passa por esse caminho.
4. `{senha_app}` (variável de template) pode injetar a senha real da conta (`clients.server_password`) em texto puro nas instruções/badges do portal — mas só se o admin explicitamente configurar um app para usar essa variável em `apps.portal_variable_fields`. É o mesmo mecanismo já usado nas mensagens de WhatsApp do bot de cobrança, não uma exposição nova — só registrando que um erro de configuração do admin nesse campo mostraria a senha real na tela.
5. `AppDetailClient.tsx` (`/renew/apps/[id]`) não tem botão de pagar licença avulsa, mesmo recebendo os dados prontos da API — só a lista principal (`RenewClient.tsx`) tem esse botão. Um cliente que chega direto nessa página com uma licença vencida não consegue pagar sem voltar pra lista.
6. Comentário desatualizado em `apps/renew-payment/route.ts` e `apps/detail/route.ts` ainda menciona `/renew-beta/apps/[id]` — rota que não existe mais (memória do projeto confirma: promovida para `/renew`).

## Sugestões de melhoria

- Decidir e implementar o filtro de contas arquivadas (achado 1).
- Unificar a lógica de label entre `apps/list` e `apps/detail` (achado 2).
- Adicionar o botão de pagar licença em `AppDetailClient.tsx` (achado 5), já que os dados já chegam prontos.

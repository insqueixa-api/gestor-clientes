# Tela: Portal — Detalhe de App (`/renew/apps/[id]`)

Arquivos: [app/renew/apps/[id]/page.tsx](../../app/renew/apps/%5Bid%5D/page.tsx), `AppDetailClient.tsx`

## O que é

Página de detalhe de um app específico instalado na conta do cliente (query `?conta=<client_id>`), parte do "Bloco 3: Configuração de Aplicativo" self-service do [Portal](portal-renew.md). Segundo comentário no próprio código, foi **substituída pelo card da lista principal em 25/07/2026** — ainda existe e funciona, mas é redundante hoje.

Permite: editar campos do app, configurar/reconfigurar via integração automática, solicitar configuração manual (apps sem integração), verificar validade, excluir/pedir remoção. **Não permite pagar licença avulsa** (só a lista principal tem esse botão — ver achado 2).

## De onde vêm os dados

`client_apps`, `apps`, `client_app_requests`, `client_portal_payments` (só para detectar renovação manual pendente), `client_portal_sessions`, `clients`/`tenant_members`/`profiles` (resolução do WhatsApp de suporte), `client_app_activity_log`.

## Rotas de API chamadas (`app/api/client-portal/apps/`)

| Rota | Escopo por client_id |
|---|---|
| `detail` | sim — `.eq("id", client_app_id).eq("client_id", client_id)` |
| `update-fields` | sim |
| `configure` | sim, via `loadClientApp(..., clientId)` — rate limit de 2 sucessos/30min |
| `request-setup` | sim |
| `check-validity` | sim |
| `remove` | sim |

## Verificação de segurança (IDOR)

**Confirmado: não há vazamento entre clientes.** Todas as 6 rotas escopam a busca por `client_id`, resolvido via `validatePortalClient(session_token, client_id)` — trocar o `id` da URL para o app de outro cliente resulta em 404, não em dado vazado.

## Verificação de exposição de senha/PIN

**Confirmado: nenhuma exposição indevida.** `HIDDEN_CLIENT_FIELD_TYPES` está vazio de propósito — o campo tipo "password" mostrado é a credencial que o próprio cliente já possui (não é segredo do parceiro nem senha da conta). PIN de integração (`app_integrations.pin`) nunca passa por `client_apps.field_values`.

## Integrações externas

Mercado Pago (só via `apps/renew-payment`, que **não é chamada por esta tela** — comentário no arquivo da rota está desatualizado nesse ponto), painéis de parceiros de app.

## Modais/componentes filhos

`ConfigureResultModal`, `ReconfigureModeModal` (compartilhados com [portal-renew.md](portal-renew.md)). `AppRequestModal` **não** é usado aqui — esse é exclusivo do admin.

## Achados (não alterados)

1. **Falha ao remover no painel do parceiro é engolida silenciosamente para o cliente.** Quando a integração automática falha ao desconfigurar mas o app não é "pago sem integração", a linha `client_apps` é apagada mesmo assim e o cliente vê "Excluído!" — comportamento intencional documentado no código ("nunca depende do painel do parceiro pra tirar o app da conta"), mas o cliente nunca sabe que a config pode ter ficado órfã no parceiro (só aparece no log que só o admin vê).
2. **Sem botão de pagar licença**, apesar de `license_price`/`license_period` já chegarem prontos da API — ver [portal-renew.md](portal-renew.md) achado 5.
3. Comentários desatualizados referenciando `/renew-beta/apps/[id]` (rota que não existe mais).

## Sugestões de melhoria

- Considerar remover esta página, já que o próprio código a marca como redundante desde 25/07/2026 — ou, se for pra manter, adicionar o botão de pagamento que falta (achado 2).
- Avisar o cliente de forma diferenciada quando a remoção falhar no parceiro (achado 1), em vez do mesmo "Excluído!" genérico.

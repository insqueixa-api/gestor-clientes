# Tela: Settings › Cupons (`/admin/settings/cupons`)

Arquivos: [page.tsx](../../app/admin/settings/cupons/page.tsx), [cupom_modal.tsx](../../app/admin/settings/cupons/cupom_modal.tsx), `impact_preview.ts`, `client_picker.tsx`

## O que é

CRUD de cupons de desconto usados no fluxo de renovação do Portal do Cliente. Suporta cupons **gerais** (com segmentação: status, servidor, plano, apps, janela de dias de vencimento/cadastro, limite total de usos) e cupons **pessoais** (presos a 1 `client_id`, autodesativam após o uso). Desconto incide só sobre o valor do plano, nunca sobre pendências. Tem prévia de impacto (quantos clientes seriam afetados, em R$) e log/reset de uso.

## De onde vêm os dados

- **`coupons`** — CRUD direto do browser, RLS por tenant.
- **`coupon_redemptions`** — só leitura pelo browser; escrita é sempre via rota de API (service role) por design.
- **`vw_clients_list_active`** — conta clientes elegíveis e planos disponíveis.
- **`clients`**, **`servers`**, **`apps`** — dados de apoio para segmentação.

## Rotas de API chamadas

- `POST /api/admin/coupons/reset-redemption` — apaga uma linha de `coupon_redemptions`, liberando o cliente para usar o cupom de novo. Valida `tenant_id` antes de deletar.
- `POST /api/admin/coupons/redeem-manual` — não é chamada por esta tela (é acionada pelo fluxo de Auditoria/Renovação Manual), grava resgate quando o admin conclui um pagamento manualmente. Idempotente por `payment_id`, desativa cupom pessoal após uso.
- `POST /api/client-portal/validate-coupon` — não é desta tela (é do Portal), mas confirma a arquitetura: rate-limit de 5 códigos por `client_id`.

## Regra "1 uso por conta" — confirmada correta (reconfirmado em 12/08/2026)

A memória do projeto registrava um ponto de confusão passado sobre "1 uso" ser por `client_id` (conta) e não por WhatsApp/pessoa — corrigido 3 vezes no histórico do projeto (ver `feedback_client_portal_scoping`). **Confirmado nesta auditoria, e reconfirmado ao vivo depois do trabalho de identidade híbrida no WhatsApp** ([portal-identidade-hibrida.md](portal-identidade-hibrida.md)), que a implementação atual está correta: `hasClientRedeemed` (já usou) e `checkCouponAbuseGuard` (rate-limit) são sempre por `client_id` exato, nunca por WhatsApp/telefone. A única função que agrupa por identidade (`resolveLinkedClientIds`) é usada exclusivamente para resolver a quem um **cupom pessoal/indicação** pertence — decisão de produto deliberada, já que recompensa de indicação vale pra pessoa inteira, não pra uma assinatura isolada. Nenhum vestígio de confusão residual encontrado; o rate-limit anti-abuso é por `client_id`, com checagem extra de que o `client_id` pertence à sessão.

## Bug `<ConfirmUI />` como tag JSX — confirmado corrigido, sem vestígios

A memória do projeto registrava um bug crítico onde `useConfirm()` usado como `<ConfirmUI />` (tag) quebrava a página inteira (React #130). Rodei uma busca completa (`grep -rn "ConfirmUI"`) em `app/` e `components/` — **todas as 30 ocorrências em 22 arquivos usam a forma correta `{ConfirmUI}`** (expressão), nenhuma usa a forma perigosa `<ConfirmUI />`. Além disso, `hooks/useConfirm.tsx` foi blindado na raiz: o hook sempre retorna `ConfirmUI: null`, e o diálogo de fato é renderizado 1x só pelo `ConfirmProvider` no layout do admin — então mesmo um novo uso futuro de `{ConfirmUI}` seria inofensivo (renderiza `null`). O código atual está 100% consistente com o padrão seguro.

## Correções aplicadas

1. **[CORRIGIDO] Reset de resgate de cupom falhava em silêncio.** Se `/api/admin/coupons/reset-redemption` falhasse (rede, permissão), o admin não recebia nenhum aviso — só percebia que o botão "Resetar" voltou ao normal sem a linha sumir da lista. Comportamento era intencional (comentário no código dizia "silencioso"), mas prefiro um aviso claro em vez de falha muda em uma ação financeira. Adicionado um aviso de erro visível nos dois modais que têm essa ação (lista de impacto e log de uso).

## Achado que fica para confirmação (envolve dinheiro — não alterado)

2. **`coupon_redemptions` não parece ter `UNIQUE(coupon_id, client_id)` no schema versionado.** A garantia de "1 uso por conta" depende inteiramente da checagem em `lib/client-portal/coupons.ts` antes do insert, sem rede de segurança no banco contra uma corrida (2 requisições simultâneas do mesmo cliente, em teoria, inserindo 2 linhas e concedendo desconto duplicado). Não é um bug confirmado na prática, mas é um ponto sem defesa em profundidade — mudar isso é uma alteração de schema em produção, prefiro confirmar antes.

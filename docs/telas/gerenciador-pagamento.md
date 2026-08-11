# Tela: Gerenciador de Pagamento (`/admin/gerenciador/pagamento`)

Arquivo: [app/admin/gerenciador/pagamento/page.tsx](../../app/admin/gerenciador/pagamento/page.tsx)

## O que é

Configuração dos gateways de pagamento/recebimento por moeda usados no Portal do Cliente: Mercado Pago e Stripe (automáticos, com API), PIX Manual e Transferência Manual (EUR/USD). Cada gateway tem prioridade (1=Principal, 2=Fallback) e pode ser marcado como fallback manual (exibido ao cliente quando os gateways online falham).

## De onde vêm os dados

- **`payment_gateways`** (`id, tenant_id, name, type, currency[], priority, is_active, is_online, is_manual_fallback, config jsonb`) — select/insert/update/delete direto client-side.

## Rotas de API chamadas

Nenhuma própria — a tela grava direto na tabela. As rotas que **consomem** essa tabela (fora desta tela) são:
- `POST /api/webhooks/mercadopago` — lê `config.webhook_secret`/`config.access_token` para validar assinatura HMAC e buscar o pagamento na API do MP.
- `POST /api/webhooks/stripe` — mesma lógica, `config.webhook_secret` para validar assinatura Stripe.
- `POST /api/client-portal/create-payment` — lê todos os gateways para montar o checkout do cliente final (escolhe o de maior prioridade `is_online=true`, ou cai no fallback manual).
- `POST /api/client-portal/apps/renew-payment` — idem, para renovação avulsa de app.

## Integrações externas

**Mercado Pago** (Access Token + Webhook Secret, PIX automático BRL), **Stripe** (Publishable Key + Secret Key + Webhook Secret, cartão EUR/USD), PIX Manual (chave direta), Transferência Bancária manual (IBAN/SWIFT EUR, routing/SWIFT USD).

## Modais

`GatewayModal` (criar/editar), `GatewayCard` (listagem), `HelpModal` (tutorial com link de doc oficial) — todos no próprio arquivo.

## Achado que fica para confirmação (envolve dinheiro/credenciais — não alterado)

1. **Credenciais de gateway (`access_token`, `secret_key`, `webhook_secret`) são gravadas em texto puro em `payment_gateways.config` (jsonb), sem criptografia no client.** A UI mascara a exibição (mostra só os 6 primeiros caracteres), mas é só cosmético — os webhooks (`mercadopago/route.ts`, `stripe/route.ts`) leem `config.access_token`/`config.webhook_secret` direto, sem camada de descriptografia. Pode ser decisão consciente para um sistema single-tenant com RLS, mas é sensível o bastante para não mexer sem confirmar — adicionar criptografia aqui quebraria os webhooks se não for coordenado com a leitura do lado deles.

## Observações não alteradas

- Trocar de moeda/tipo de um gateway já criado não é possível pela UI (o seletor de tipo só aparece na criação) — funcional, mas confunde quem só queria "converter" um PIX Manual em Transferência; a solução hoje é excluir e recriar.
- Não há validação de formato das chaves (ex.: aviso automático se o admin colar uma chave de teste `sk_test_`/`pk_test_` em vez de produção) além do texto de ajuda no `HelpModal`.

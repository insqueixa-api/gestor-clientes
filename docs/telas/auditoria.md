# Tela: Auditoria (`/admin/auditoria`)

Arquivo: [app/admin/auditoria/page.tsx](../../app/admin/auditoria/page.tsx)
Componente filho: [app/admin/auditoria/AplicativosLog.tsx](../../app/admin/auditoria/AplicativosLog.tsx)

## O que é

Log de ponta a ponta dos pagamentos/renovações feitas pelo cliente no Portal (aba **IPTV**) e dos pedidos manuais de configuração de app sem integração automática (aba **Aplicativos**). Permite reprocessar pagamentos travados, concluir/cancelar renovações manuais, confirmar transferência bancária e reenviar comprovante de WhatsApp sem sair da tela.

## De onde vêm os dados

- **`client_portal_payments`** — fonte principal da aba IPTV (`id, created_at, client_id, payment_method, status, fulfillment_status, fulfillment_error, price_amount, period, plan_label, gateway_type, mp_payment_id, whatsapp_status, coupon_code, coupon_discount_amount, payment_type, app_name_snapshot, client_app_id`, entre outras).
- **`clients`**, **`servers`** — enriquecem nome/login/servidor do cliente.
- **`client_alerts`** (join `client_apps(apps(name))`) — rótulo das pendências quitadas junto do pagamento.
- **`message_templates`** — busca (por nome, ver achado 3) do template "Pagamento Realizado" pro reenvio de WhatsApp.
- Aba Aplicativos (`AplicativosLog.tsx`): **`client_app_requests`** (join `clients(...servers(name))`), **`client_app_activity_log`**, **`apps.fields_config`**.
- **RPCs** (`SECURITY DEFINER`, guardadas por `tenant_members`): `update_fulfillment_status`, `update_whatsapp_status`, `approve_manual_payment`, `resolve_notification`.

## Rotas de API chamadas

| Rota | Uso |
|---|---|
| `POST /api/admin/payments/retry-fulfillment` | Botão "Reprocessar" — reroda lock + fulfillment de um pagamento travado |

O resto das ações (marcar concluído, cancelar, confirmar transferência, resolver manualmente) é feito direto via RPC no client, não por rota de API.

## Integrações externas

- **WhatsApp** (`/api/whatsapp/envio_agora`) — reenvio de comprovante.
- Indiretamente, via "Reprocessar": Mercado Pago/Stripe e o fulfillment automático do servidor Elite (lógica em `lib/client-portal/fulfillment.ts`).

## Modais/componentes filhos

- `AplicativosLog.tsx` — aba "Aplicativos": pedidos manuais de setup/exclusão de app + atividade do portal, com concluir/cancelar.
- `RecargaCliente` (`app/admin/cliente/recarga_cliente.tsx`) — modal de renovação manual, reaproveitado aqui para pagamentos `payment_type = "subscription"`.
- `AppRequestModal` (`components/apps/AppRequestModal.tsx`) — reusado para pedido manual, renovação avulsa de licença de app, e dentro do card de apps do cliente.

## Achados e correções aplicadas

1. **[CORRIGIDO] Filtro "WhatsApp: Aguardando" misturava pagamentos já resolvidos manualmente.** `whatsapp_status === "manual"` caía no bucket "aguardando" no filtro, apesar do badge visual já tratar "manual" como status separado (mostra "Manual"). Filtrar por "Aguardando" trazia linhas que a própria tela já rotulava como resolvidas. Adicionada a opção "Manual" no filtro, com a mesma lógica do badge.

## Achados que ficam para confirmação (envolvem dados financeiros — não alterados)

2. **Log de pagamentos limitado a 50 registros, mesmo com busca/filtro ativos, e mesmo a UI oferecendo "itens por página" até 200.** A tela se descreve como "log completo de ponta a ponta dos pagamentos", mas hoje é estruturalmente impossível ver além dos 50 pagamentos mais recentes do tenant. Como é uma tela de auditoria financeira, prefiro confirmar antes de subir/remover esse limite (pode ser intencional por custo de leitura).
3. **Busca do template de WhatsApp por nome "fuzzy" em vez de referência fixa.** O reenvio de comprovante busca o template com `.ilike` em variações de "pagamento/pago/realizado" e pega o primeiro por ordem alfabética — se existir mais de um template com nome parecido, pode reenviar o texto errado como comprovante. Recomendo migrar para uma referência fixa (id/slug), mas isso muda a estrutura de `message_templates` e prefiro alinhar antes.
4. Os logs da aba "Aplicativos" (`client_app_requests`, `client_app_activity_log`) têm limite de 200 sem paginação real — mesmo problema estrutural do item 2, só que com teto mais alto.

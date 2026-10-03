# Alertas "em confiança" — plano (02/10/2026)

Pedido do Márcio. Problema: renovar a mensalidade "em confiança" pelo admin
registrava como paga na hora (entrava no saldo sem o dinheiro ter caído), e a
baixa manual de pendência de app (👍 no sino) só fechava o sino — o valor
nunca era computado.

## Regras (decididas pelo Márcio)
- Tipos do sino: **Ativação de aplicativo** · **Renovação em confiança**
  (mensalidade) · **Alerta normal**. "Pendência qualquer" sai (as antigas
  continuam visíveis até resolver).
- Renovar em confiança (admin): renova no servidor (gasta crédito), envia a
  mensagem e **só cria o sino** (plano, período, telas, data). Nada no Log do
  Portal, nada em client_renewals → nada no saldo.
- Portal, pendência + mês novo juntos: 1 pagamento (igual Josy), sino fecha.
- Portal, **"Pagar só a pendência"**: registra o pagamento, fecha o sino,
  **não renova** (não chama o painel, não gasta crédito).
- Baixa manual (👍): registra o pagamento na data da baixa — mensalidade:
  client_renewals PAID ("renovação de DD/MM em confiança") + linha manual no
  Log; app: linha app_renewal manual no Log (conta em Aplicativos).
  Forma: cliente BRL → PIX Manual; EUR → Revolut.
- Ativação/renovação de app pelo admin: pergunta se quer registrar no sino
  "em confiança" e, opcionalmente, criar cupom pessoal (código aleatório,
  %, valor editável) daquele app — o desconto já entra no valor do sino;
  o uso do cupom é registrado na quitação.

## Etapas
1. Banco (client_alerts.kind/meta) + sino (tipos novos, formulário da
   mensalidade com tabela/período, cupom no app) + baixa manual registrando
   pagamento.
2. Admin: opção "Em confiança" no Renovar + pergunta depois de
   ativar/renovar app.
3. Portal: textos novos, "Pagar só a pendência" (pagamento que não renova),
   fulfillment, uso de cupom + revisão de segurança (duplicidade,
   idempotência, RLS).

## Etapa 3 — como ficou (02/10/2026)
- `client_portal_payments.payment_type = 'pending_charge'` (SQL:
  `docs/sql/alertas_confianca_etapa3.sql`, já aplicado).
- Portal: card "📋 Pendência em aberto" na tela de Pagamentos + botão
  "Pagar só a pendência" no modal "Pendência identificada" (o "Continuar"
  virou "Pagar tudo e renovar"). PIX/cartão no mesmo modal do app avulso.
- Rota `app/api/client-portal/pay-pending` — valor sempre dos sinos OPEN no
  banco; só gateway online (MP, FastFlow/FastPay, Stripe). Transferência
  manual continua pelo 👍 do sino.
- Aprovação: os 5 caminhos (webhooks MP/Stripe/FastDePix, payment-status,
  retry-fulfillment) caem no `runFulfillment`, que desvia `pending_charge`
  logo no início pra `settle_portal_payment_alerts` (service role): nunca
  renova, nunca gasta crédito. renewal_trust → client_renewals PAID; cupom
  do sino registrado; sinos fechados; pagamento concluído.
- Mensalidade + pendência também usa a função agora (corrige: cupom do sino
  não era registrado quando pago junto com a mensalidade).
- Painéis/Financeiro: parte de app do pending_charge = price_amount −
  plan_price_amount (plan_price_amount = parte da renovação em confiança).
- Segurança: valor recalculado no servidor; sessão + posse da conta; função
  só service_role, trava pagamento e sinos (FOR UPDATE), idempotente;
  idempotency key no MP/Stripe e reaproveita PIX pendente igual; PIX antigo
  de outra seleção é cancelado no MP. Sino já fechado quando o pagamento
  chega (pago 2x) → aviso "⚠️ Pendência paga 2x?" no sino do admin
  (sem estorno automático).

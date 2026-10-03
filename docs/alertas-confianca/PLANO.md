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

# Portal da Revenda + crédito pela API — Plano (06/10/2026)

O pedido do Márcio tem 4 partes:

- **Portal:** a revenda acessa o portal "igual ao do cliente". Em Aplicativos ela cadastra os clientes **dela**, informando Device ID/MAC, Device Key e link M3U, e escolhe entre **configurar** ou **pagar a ativação**. Só aparecem os aplicativos integrados.
- **Pagamento:** antes de pagar, o sistema confere o vencimento real do app para ver se está elegível para renovação.
- **Aviso:** depois de pagar, uma mensagem automática vai para o WhatsApp da revenda com o app, a quem se refere (usuário tirado do M3U) e o novo vencimento.
- **Crédito pela API:** enviar créditos para a revenda direto pela API do servidor. Primeiro o NaTV; Elite e Fast depois.

---

## 1. Retrato de hoje (banco e código em 06/10/2026)

**Revendas.** Só existe uma ativa: **Jaime**, WhatsApp 5522992760092, ligado ao NaTV com o usuário `Jaime1983`.

| Tabela | O que guarda |
|---|---|
| `resellers` | nome, whatsapp, e-mail, notas, arquivado |
| `reseller_phones` | telefones extras |
| `reseller_servers` | vínculo revenda↔servidor: `server_username`, `server_password`, preço unitário, última recarga |
| `server_credit_sales` | 12 vendas para revenda, 120 créditos no total, a última em 20/09 |

- Hoje a recarga de revenda (`app/admin/revendedor/recarga_revenda.tsx`) **só registra** a venda: chama `sell_credits_to_reseller_without_balance` e depois o sync do saldo. O crédito em si o Márcio envia **na mão** no painel do servidor. Depois disso o sistema manda o comprovante por WhatsApp (`/api/whatsapp/envio_agora`).
- O Jaime **não** é cliente e **não** tem token de portal.

**Portal do cliente (`/renew`).**
- **Login:** é por token mágico (`client_portal_tokens.whatsapp_username`). A RPC `portal_start_session` cria a sessão, que fica em `client_portal_sessions`. Toda rota passa por `validatePortalClient()` (`lib/client-portal/session.ts`), que só conhece **cliente** (`client_id`).
- **Apps:** `client_apps.field_values` guarda MAC, key e o vencimento no campo `date`. As listas M3U ficam em `clients.m3u_url` e `m3u_url_secondary`.
- **Orquestração:** `lib/apps/orchestration.ts` (`configureClientApp`, `checkClientAppValidity`, `removeClientAppFromPartner`) lê **sempre** `clients` para montar a M3U e o nome da lista (`<usuario>_<Servidor>`). Ela continua respeitando a regra "Configurar nunca apaga outras listas" (`exact_only`).
- **Pagamento de licença:** `apps/renew-payment` e o embutido em `create-payment` gravam em `client_portal_payments`, com `payment_type` em (`subscription`, `app_renewal`, `pending_charge`). O `client_id` é **NOT NULL**. O cumprimento fica em `lib/client-portal/fulfillment.ts` (Appativa, DupleCast, GerenciaApp Roku), e o WhatsApp sai por `sendAppRenewalWhatsapp`.
- `PORTAL_ADD_APP_HIDDEN = true`: o "+ Adicionar aplicativo" está escondido até a vitrine nova (refactor de apps, fase 4).

**Apps "integrados".** São 55 apps ativos com `integration_type` ou Appativa.
- Configurar M3U pela API funciona nos que têm handler `useApi`: IBO, Quick, Ninja, DupleCast, Flex, GerenciaApp e outros.
- Pagar ativação funciona nos que têm `appativa_app_id` (a maioria) ou renovação própria (DupleCast, GPC Roku).
- Bay TV, Set IPTV e SmartOne têm só ativação, sem configurar lista (captcha).
- Os gratuitos do GerenciaApp (IBO Revenda, UNI, VU, Zone X, GPC Pro, IBONew) usam a **conta de revenda do Márcio** no GerenciaApp.

**API NaTV** (`https://revenda.pixbot.link`, `openapi.json` público). O token é Bearer, com limite global de 1 chamada a cada 150 ms.
- `POST /reseller/credits`: transfere crédito para o master ou para uma sub-revenda **direta**. O mínimo é 5 (ou 4 se o destino tiver exatamente 1). Limite de 3 chamadas a cada 5s e 10 por minuto. **Não tem chave de idempotência.**
- `POST /reseller/subreseller/search`: lista as sub-revendas diretas com os créditos de cada uma.
- `GET /reseller/me` (saldo, que já usamos) e `GET /report/actionlog` (histórico de créditos, 1 chamada por minuto).
- O Márcio informou que a transferência "não está habilitada" na chave atual. Isso precisa ser liberado no painel do NaTV.

**Elite e Fast.** Os dois permitem enviar crédito, segundo o Márcio, mas **não temos a documentação desse endpoint** no projeto. O Márcio não tem revenda no Elite hoje.

---

## 2. Desenho proposto

### 2.1 Login da revenda (mesmo portal, outro "modo")
- `client_portal_tokens` e `client_portal_sessions` ganham `reseller_id uuid null`. O link é gerado pelo admin, na página da revenda.
- `portal_start_session` devolve o tipo de sessão (`client` | `reseller`).
- Entra uma nova validação `validatePortalReseller(session_token)` → `{tenant_id, reseller_id}`. **Nada muda** em `validatePortalClient`, então nenhuma rota de cliente é afetada.
- **Tela:** o `/renew` detecta a sessão de revenda e mostra a "Home da Revenda", reaproveitando os componentes do portal (`AppPickerModal`, detalhe do app, pagamento PIX). Não vamos enfiar mais lógica no `RenewClient.tsx`, que já tem 7 mil linhas: a home da revenda vira um componente próprio.

### 2.2 Dados dos clientes da revenda (tabelas novas, separadas de `clients`)
Ficam separadas para **não** contaminar a lista de clientes, a cobrança automática, os dashboards, o financeiro e o Papa Testes.

```
reseller_end_users      id, tenant_id, reseller_id, label, m3u_url,
                        m3u_username (extraído do link), server_id (detectado pelo DNS),
                        notes, created_at, updated_at
reseller_end_user_apps  id, tenant_id, reseller_end_user_id, app_id,
                        field_values jsonb (mac, device_key, date…), device_type,
                        created_at, updated_at
```

- **Usuário da M3U:** vem do `username=` do link (`get.php?username=…`). O servidor é detectado comparando o domínio com `servers.dns`. Se não bater, a revenda escolhe entre os servidores vinculados a ela.
- **Nome da lista no aparelho:** `<usuario_m3u>_<Servidor>`, mesma convenção dos clientes, sempre com `exact_only`.
- **Acesso:** RLS ligado, com acesso só pelo servidor (service role) e leitura no admin por tenant.

### 2.3 Orquestração
- `orchestration.ts` passa a aceitar um **"alvo"** genérico, com M3U, nome da lista, `field_values` e a função que grava o vencimento.
- O caminho de cliente continua **idêntico**. Ele só é embrulhado no alvo, com testes antes e depois.
- O caminho de revenda monta o alvo a partir de `reseller_end_users` e `reseller_end_user_apps`.
- A regra "Configurar nunca apaga outras listas" continua valendo para os dois.

### 2.4 Pagamento da ativação
- **Opção recomendada:** usar a mesma tabela `client_portal_payments`, com `payment_type = 'reseller_app_renewal'`, `client_id` liberado para nulo (com CHECK: cliente **ou** revenda) e colunas novas `reseller_id` e `reseller_end_user_app_id`. Assim os webhooks de Mercado Pago, Stripe e FastDePix já funcionam.
- **Custo da opção:** pela regra de "alertas em confiança", todo `payment_type` novo tem de passar pelos 5 caminhos e pelas views (Auditoria, Log do Portal, Financeiro, receita, alertas) e ser filtrado onde não deve aparecer.
- **Checagem de vencimento em 2 momentos:**
  1. Ao clicar em **Pagar**, o sistema consulta o vencimento real (`checkClientAppValidity`). Se o app não estiver elegível, o pagamento não é criado.
  2. **De novo no cumprimento**, antes de ativar. Se tiver mudado, fica `manual_pending` com alerta no sino.
- **Cumprimento:** a mesma lógica de `resolveAppativaAppRenewal` e das renovações próprias (DupleCast, GPC Roku), adaptada ao alvo de revenda.
- **Mensagem:** template novo "Revenda — aplicativo ativado", com as variáveis `{aplicativo}`, `{usuario}` (da M3U) e `{vencimento}`. Vai para o WhatsApp da revenda, com recibo ✓✓.
- **Segurança:** antes de ligar, passar o checklist de fraude completo (RLS, duplicação, idempotência).

### 2.5 Admin
- A página da revenda (`/admin/revendedor/[id]`) ganha:
  - aba **"Clientes da revenda"**, com os usuários, os apps, os vencimentos e os pagamentos;
  - botão **"Gerar link do portal"**.

### 2.6 Crédito pela API (NaTV primeiro)
- **Função nova:** `lib/integrations/natv-credits.ts`, com `transferNatvCredits(integration, username, amount)`.
- **Recarga da revenda:** quando o servidor é NaTV, aparece a opção "Enviar créditos pelo painel automaticamente". O fluxo é:
  1. Validar as regras antes: mínimo de 5 (ou 4) e Jaime1983 aparecendo em `subreseller/search`.
  2. **Gravar a venda como "transferência pendente"** antes de chamar a API.
  3. Com resposta 200, confirmar com `caller_credits` e `recipient_credits` e rodar o sync do saldo.
  4. Com erro 400, 402 ou 404, desfazer a pendência e mostrar a mensagem do NaTV.
  5. Com timeout, **não repetir sozinho**, porque a API não tem idempotência e o crédito poderia sair em dobro. O sistema confere o saldo da sub-revenda (`subreseller/search`) e só então marca como concluída ou falha.
- **Elite e Fast:** mesmo desenho, depois de recebermos a documentação do endpoint de cada um.

> ✅ **Fase 1 implementada em 06/10/2026** (commit 2ef1c7e9): `reseller_credit_transfers` (SQL aplicado), `lib/integrations/natv-credits.ts` e `app/api/integrations/natv/transfer-credits` (actions `transfer`, `open` e `resolve`). Na tela, o switch "Enviar os créditos no NaTV automaticamente" e o aviso "Chegou / Não chegou". A API do NaTV **não tem como retirar crédito** (o valor precisa ser maior que 0 e o envio só vai para o master ou para uma sub-revenda direta). Leitura conferida: Jaime1983 é sub-revenda direta.

### 2.7 Tabela de preço de crédito para revenda (pedido do Márcio, 06/10/2026)
- É uma tabela **só em BRL**, com **pacotes de créditos** (ex.: 10, 20, 30, 50, 100) e o preço de cada pacote.
- Cada **linha é um servidor**. O Márcio vai "adicionando servidores" e uma única tabela cobre todos os servidores do sistema.
- A revenda é ligada a uma tabela, como o cliente é ligado a uma tabela de planos.
- A tabela serve para a recarga do admin (preço sugerido) e, mais adiante, para a revenda comprar crédito sozinha por PIX no portal (fase 5).

---

## 3. Fases sugeridas

| Fase | Entrega | Mexe em dinheiro? |
|---|---|---|
| 0 | Decisões abaixo + liberar a transferência na chave NaTV | — |
| 1 | Crédito NaTV automático na recarga da revenda (independente do resto, menor e de valor imediato) | sim (crédito) |
| 2 | Login da revenda + cadastro de clientes e aparelhos + **Configurar M3U** (sem pagamento) | não |
| 3 | **Pagar ativação** + checagem de vencimento + mensagem à revenda | sim |
| 4 | Aba no admin + Auditoria e Financeiro + checklist de fraude | — |
| 5 | Elite e Fast (crédito); opcional: revenda comprar créditos por PIX no portal, com envio automático | sim |

---

## 4. Decisões pendentes (Márcio)

1. **Preço da ativação para a revenda:** o mesmo `license_price` do cliente ou uma tabela de revenda com desconto?
2. **Regra de elegibilidade:** quando o app pode ser renovado? Exemplo: vencido ou vencendo em até N dias; vitalício nunca. Qual é o N?
3. **Apps gratuitos do GerenciaApp** (IBO Revenda, UNI, VU, Zone X…): a revenda pode usar? Eles consomem a sua conta de revenda no GerenciaApp.
4. **Configurar sem pagar** fica liberado para a revenda à vontade, com o mesmo limite do cliente (3 tentativas em 30 min)?
5. **Sessão de WhatsApp** que manda a mensagem para a revenda: a padrão ou a do servidor?
6. **Crédito:** fase 1 só pelo seu botão de recarga, ou já planejar a revenda comprando crédito sozinha pelo portal (fase 5)?
7. **Elite e Fast:** mandar a documentação (ou print) do endpoint de envio de crédito de cada um.

### 07/10/2026 — nome do cliente (pedido do Márcio)
- No modal da revenda o campo "Ambiente" (tipo `obs`) não aparece; o **Nome do cliente** vem sempre no topo e TODOS os campos são obrigatórios (tela e servidor) → `reseller_client_apps.client_label`. O servidor ignora `obs` vindo da revenda.
- **Etapa B (pagamento da licença) tem que usar esse nome:**
  - na mensagem de WhatsApp pra revenda (app, cliente, usuário do M3U, novo vencimento);
  - no histórico da página do revendedor (admin `/admin/revendedor/[id]`), junto das recargas: qual aplicativo, de qual cliente, quando foi ativado e o novo vencimento.

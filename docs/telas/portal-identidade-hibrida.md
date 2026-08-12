# Arquitetura: identidade híbrida no WhatsApp (telefone ou username)

Não é uma tela — é uma mudança transversal que toca o Portal do Cliente inteiro, feita em 12/08/2026 para o sistema aceitar tanto telefone quanto um username reservado do WhatsApp no campo `whatsapp_username`, sem quebrar ninguém. Documentado à parte porque cruza muitos arquivos listados em telas separadas.

## Contexto

O WhatsApp está migrando para permitir contato por `@username`, além do telefone (rollout gradual da Meta). Separado disso — e mais urgente — existe a migração técnica de JID (telefone) para LID (identificador opaco), já em andamento desde 2024, que afeta diretamente bibliotecas não-oficiais como o Baileys (usado pela VM deste sistema).

## O que existe hoje

**Na VM (`whatsapp-service/src/sessionManager.js`)**: `validateNumber` agora também alimenta o `lidPhoneMap` (que já existia só para o fluxo de `allowedNumbers`) — toda validação de número contribui para deixar a resolução LID→telefone mais completa no caminho de entrada (mensagens/ligações recebidas).

**`lib/whatsapp/template-vars.ts`**: `firstNormalizedPhone(a, b, c)` normaliza cada candidato individualmente antes de cair para o próximo — corrige o padrão antigo `normalizeToPhone(a || b || c)`, que escolhia o primeiro valor truthy antes de normalizar (um `whatsapp_username` sem dígitos nunca caía para o telefone real em `whatsapp_e164`/`phone_e164`). Usado em `fetchClientWhatsApp` e `fetchResellerWhatsApp` — o envio de mensagem sempre encontra um telefone de verdade, mesmo quando a identidade é um username.

**Âncora de telefone (banco de dados)** — `docs/sql/portal_phone_anchor_hybrid_identity.sql`: várias contas do mesmo tenant podem compartilhar o mesmo WhatsApp (cenário real e comum). O login/sessão do Portal precisa continuar funcionando para todas mesmo que uma delas troque de `whatsapp_username` para um username. Solução:

- `client_portal_tokens` e `client_portal_sessions` ganharam uma coluna `phone_anchor` (telefone normalizado, resolvido uma vez na criação do token/sessão — nunca é "movido" entre identidades, ao contrário de uma tentativa anterior removida por bug).
- RPC central `portal_client_ids_for_identity(tenant_id, whatsapp_username, phone_anchor)` resolve "quais `client_id` essa identidade pode acessar" — por texto (`whatsapp_username`/`secondary_whatsapp_username`, comportamento de sempre) **ou** por âncora de telefone.
- `portal_admin_create_token_for_whatsapp_v2` e `portal_start_session` foram reescritas para usar essa lógica — reaproveitam o mesmo código mágico entre contas que compartilham telefone, mesmo depois de uma renomear.

**Todas as rotas do Portal que verificam "esse `client_id` pertence a essa sessão"** foram atualizadas para usar a mesma RPC (`portal_client_ids_for_identity`) em vez de um filtro de texto próprio:

- `lib/client-portal/session.ts` (`validatePortalClient`) — usada por quase toda rota do Bloco 1/3 (apps/list, apps/detail, apps/add, apps/configure, apps/remove, apps/renew-payment, apps/request-setup, apps/check-validity).
- `app/api/client-portal/get-accounts/route.ts` — listagem inicial de contas.
- `app/api/client-portal/get-prices/route.ts` — carregar plano/preço.
- `app/api/client-portal/create-payment/route.ts` — gerar cobrança/PIX (renovação + pendências, que são bundladas na mesma rota).
- `app/api/client-portal/payment-status/route.ts` — confirmar que o pagamento foi aprovado (polling).
- `app/api/client-portal/pending-charges/route.ts`, `validate-coupon/route.ts` — prévias.
- `app/api/client-portal/guia-tv/sugestao/route.ts`, `sugestao/historico/route.ts` — sugestão de conteúdo.

**`lib/client-portal/coupons.ts`** (`resolveLinkedClientIds`) — usada **só** para resolver a quem um **cupom pessoal/indicação** pertence (decisão de produto antiga, documentada em [[project_portal_coupon_feature]]: cupom pessoal vale pra pessoa inteira, não pra uma conta isolada — diferente do "1 uso" de cupom geral, que é por `client_id` exato e não foi tocado). Agora também resolve pela âncora de telefone da própria conta (busca `phone_e164` direto, sem depender de os chamadores já terem selecionado esse campo).

## O que NÃO muda (confirmado, não é afetado por nada disso)

- **"1 uso" de cupom geral** (`hasClientRedeemed`) — sempre por `client_id` exato. Ver [settings-cupons.md](settings-cupons.md) e [[feedback_client_portal_scoping]].
- **Rate limit anti-abuso de cupom** (`checkCouponAbuseGuard`) — sempre por `client_id` exato.
- **Log de Auditoria do admin** (`app/admin/auditoria/page.tsx`) e as ações "resolver" (reprocessar, aprovar, concluir) — nunca dependeram de `whatsapp_username`, sempre trabalharam por `client_id`/`payment_id`. Confirmado lendo a query real da tela e as 4 RPCs usadas pelos botões de ação.
- **Admin (`novo_cliente.tsx`)** — Telefone deixou de ser campo obrigatório (só WhatsApp é, aceitando telefone ou username). Se a conta ficar sem telefone identificável em lugar nenhum, um aviso não-bloqueante avisa que ela não poderá receber mensagens automáticas até o WhatsApp liberar envio por username de verdade (limitação das bibliotecas não-oficiais hoje, não do código).

## Retrocompatibilidade

Tokens/sessões criados antes desta migração têm `phone_anchor = NULL` — continuam funcionando exatamente como sempre funcionaram (matching só por texto). A âncora é preenchida de forma preguiçosa (na primeira vez que o token é reaproveitado) ou direto para tokens/sessões novos. Confirmado na prática: sessões reais de clientes ativos durante a migração seguiram funcionando sem interrupção.

## Testado ao vivo (não só lido)

Com uma conta de teste real (5 contas compartilhando o mesmo WhatsApp, uma renomeada para um username): mesmo código mágico antes/depois da troca, login funcionando, listagem de contas mostrando as 5, carregar plano/preço, ownership de pagamento (renovação/pendência/pagamento de app), e o agrupamento de cupom pessoal — todos verificados diretamente contra o banco de produção antes e depois de cada correção.

Depois, com uma segunda conta de teste (sem telefone nenhum, só um username aleatório com "_"), achado e corrigido mais um ponto:

- **`portal_resolve_token`** devolvia o `whatsapp_username` do TOKEN (sempre normalizado — `normalize_phone`, tira tudo que não é `[a-zA-Z0-9]`) direto pra tela de login (`app/LoginClient.tsx`), que só usa isso pra **exibir/pré-preencher** o campo (o `POST /api/client-portal/login` real manda só `{ token, cfToken }`, nunca esse texto — a checagem de acesso nunca dependeu dele). Pra telefone isso nunca importou (dígitos puros não mudam ao normalizar), mas um username com "_" (ex: `zeleite_bd79f4`) aparecia como `zeleitebd79f4` na tela — sumia o caractere, parecia (e não era) um valor errado. Corrigido pra buscar o texto CRU de um `clients.whatsapp_username` que bate com a identidade (texto ou âncora) e mostrar esse — puramente cosmético, não muda quem consegue entrar.

## `plan_table_id` é obrigatório — não existe "cliente sem tabela de preço" legítimo

`get-prices/route.ts` tem um fallback pra tabela padrão BRL quando `client.plan_table_id` é `null` — mas isso é uma rede de segurança para o caso da tabela **atribuída** ter sido desativada/apagada depois, não uma forma válida de nascer sem tabela. `create_client_and_setup` (RPC usada por `novo_cliente.tsx`) sempre vincula uma tabela na criação; confirmado em produção (12/08/2026) que 0 clientes reais estão com `plan_table_id is null`. A tela do Portal (`RenewClient.tsx`) reflete esse invariante de propósito: só chama `get-prices` se `account.plan_table_id` existir — não tenta "adivinhar" um plano pra uma conta que nunca deveria estar sem um. (Uma conta de teste criada nesta sessão via `INSERT` direto, pulando a RPC de criação, ficou momentaneamente sem tabela e escondeu o "Escolha o Plano" no Portal — corrigido atribuindo a tabela à conta, não mudando o código.)

# Portal do cliente: menu de 3 blocos (`/renew-beta`)

## Contexto

O portal do cliente (`app/renew/RenewClient.tsx`) hoje abre direto na tela
de pagamento/renovação, com um banner pequeno de "Novidades no servidor!"
linkando pro guia de TV. O objetivo é reorganizar isso em 3 blocos de
entrada bem destacados, com um novo bloco de autoatendimento pra
configuração/manutenção de aplicativo — hoje esse fluxo passa pelo bot ou
é feito manualmente.

Como é um escopo grande (3 blocos + páginas de detalhe por app parceiro +
filtro novo no admin), a implementação está indo por fases. Este doc cobre
a **entrega 1**.

## Entrega 1 (concluída)

Rota paralela de teste `app/renew-beta/`, sem tocar a rota real `/renew`.
Reaproveita 100% da lógica de sessão, busca de contas e fluxo de pagamento
de `RenewClient.tsx` — a única mudança é um novo estado
`activeSection: "menu" | "payment" | "apps"` que controla o que renderiza
depois que a conta é selecionada.

- **Bloco 1 — Pagamentos e Renovação**: o conteúdo de pagamento existente,
  só sem o banner de novidades (removido daqui).
- **Bloco 2 — Novidades e Conteúdo**: o banner de novidades promovido a
  card do menu, com chips linkando pra `/renew/guia-tv` (grade de
  programação, jogos do dia, filmes e séries).
- **Bloco 3 — Configuração de Aplicativo** (novo): lista **somente
  leitura** dos apps instalados na conta (nome, ícone, vencimento, e
  campos "seguros" como MAC/Device Key — nunca senha/PIN). Chama a nova
  rota `app/api/client-portal/apps/list/route.ts`, que segue o mesmo
  padrão de autenticação de `app/api/client-portal/get-prices/route.ts`:
  recebe `session_token` + `client_id`, revalida contra
  `client_portal_sessions`, e confirma que o `client_id` pertence a esse
  `whatsapp_username` (dono ou secundário) antes de devolver qualquer
  dado.

### Arquivos

- `app/renew-beta/page.tsx`, `app/renew-beta/RenewBetaClient.tsx` — cópia
  adaptada de `app/renew/page.tsx` + `RenewClient.tsx`.
- `app/api/client-portal/apps/list/route.ts` — nova rota, view-only.
- Nenhum arquivo de `/renew` foi modificado.

### Teste

Sem ambiente de staging neste projeto — testado com Playwright local
contra a conta real "InsqueixaElite" (`client_id`
`27a871c0-4850-4bd0-8a5a-52609abe569f`), usando uma sessão de teste
inserida diretamente em `client_portal_sessions` e removida depois do
teste. Confirmado: os 3 blocos renderizam, navegação entre eles funciona
(inclusive "voltar"), e o Bloco 3 lista os apps reais da conta (Quick
Player Pro, DupleCast, DuplexPlay etc.) com os campos certos.

## Fases seguintes (ainda não implementadas)

- **Configurar/editar/remover app de verdade pelo portal** — as rotas
  `app/api/integrations/apps/*/route.ts` (gerenciaapp, duplecast, ibosol,
  ibopro, quickplayer) hoje exigem sessão admin
  (`supabase.auth.getUser()`), que o portal não tem. Ideia cogitada: usar
  o `INTERNAL_API_SECRET` já existente como segunda via de autenticação
  nessas rotas, chamada só server-to-server a partir de uma rota nova do
  portal — sem duplicar a lógica de `buildCreatePayload` que já existe em
  `lib/integrations/*.ts`.
- **Páginas de detalhe por app** (`[id]`) com instruções específicas do
  parceiro (NaTV 4100/4102, Fast pfast, Elite manual).
- **Filtro Financeiro/Aplicativos** na tela admin "Log do Portal"
  (`app/admin/auditoria/page.tsx`), replicando o padrão de
  `app/admin/dashboard-filter.tsx` — só faz sentido quando o Bloco 3 gerar
  eventos reais de configuração pra logar.
- **Pagamento avulso só do app**, sem renovação junto.
- Promover `/renew-beta` pra substituir `/renew` (ou redirecionar) quando
  o escopo acima estiver fechado.

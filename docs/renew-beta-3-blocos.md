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
as **entregas 1 e 2**.

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

## Entrega 2 (concluída) — Bloco 3 self-service de verdade

O Bloco 3 virou 3 sub-abas dentro de `activeSection === "apps"`
(`appsSubTab: "meus-apps" | "novo-dispositivo" | "duvidas"`).

- **Meus aplicativos**: editar campos, **Reconfigurar** (chama de verdade
  o painel do parceiro) e **Remover** (idem + apaga a linha), picker
  "+ Adicionar aplicativo", e bloco de link M3U com Gerar/Mostrar/Copiar/
  **Remover** (capacidade nova, o admin só tinha Gerar/Copiar).
- **Novo dispositivo**: instruções por tipo de aparelho, com chips de
  filtro (Samsung/LG, Android/TVBox, iOS, Fire TV, Roku, Computador).
- **Dúvidas e sugestões**: FAQ em accordion agrupado por categoria + botão
  de fala com o suporte via WhatsApp.

**Auth bridge (a parte arriscada da entrega 1)**: as 5 rotas
`app/api/integrations/apps/{duplecast,gerenciaapp,ibosol,ibopro,quickplayer}/route.ts`
agora aceitam um header `x-internal-secret` (comparação em tempo
constante, `lib/internal-auth.ts`) como alternativa à sessão admin — mesmo
padrão já usado por `natv/fast/elite sync`. As novas rotas do portal
chamam essas rotas server-to-server usando esse header (nunca expõem o
segredo pro navegador do cliente).

**Novas rotas do portal** (todas em `app/api/client-portal/`, auth
centralizada em `lib/client-portal/session.ts`):
`apps/add`, `apps/catalog`, `apps/update-fields`, `apps/configure`,
`apps/remove`, `m3u`, `faq`.

**FAQ/instruções vêm de `bot_knowledge`** — mas com uma ressalva
importante: o `content` original daquela tabela é escrito como instrução
PRO BOT ("peça pro cliente", "encaminhe pro Márcio"), não é texto pronto
pra cliente ler. Por isso a migration
`docs/sql/bot_knowledge_portal_content.sql` adiciona `portal_visible`,
`portal_category` (`faq`/`device_setup`), `portal_content` (texto
client-facing, **escrito à parte**) e `portal_device_types`. Uma entrada
só aparece no portal com `portal_visible=true` **e** `portal_content`
preenchido. Curadoria pelo admin em
`app/admin/settings/whatsapp/page.tsx` (componente `KnowledgeBase`, seção
"Visível no portal do cliente"). Duas entradas reais já foram curadas
como exemplo (Teste de velocidade → FAQ/Manutenção; iPhone/iPad → Novo
dispositivo/iOS).

**Centralização feita nesta entrega** (eliminando cópias duplicadas):
`lib/apps/field-types.ts` (tipos de campo + labels + `normalizeMacInput`,
antes triplicado), `lib/apps/device-types.ts` (device types, antes só no
admin), `lib/apps/panel.ts` (helpers de chamada ao painel do parceiro).

### Teste (entrega 2)

Mesmo padrão — sessão de teste real, sem staging. Detalhe extra: as novas
rotas fazem uma chamada HTTP pra si mesmas via
`UNIGESTOR_APP_URL`/`INTERNAL_API_SECRET` (mesmo padrão de
`lib/client-portal/fulfillment.ts`); em `.env.local` essa URL aponta pra
produção, então testar localmente exige rodar o dev server com
`UNIGESTOR_APP_URL=http://localhost:3000` só para esse teste (documentado
aqui pra não redescobrir depois). Confirmado ao vivo na conta
"InsqueixaElite": editar campo, Reconfigurar (chamada real em
`api.quickplayer.app`, recriou a playlist do MAC de teste
`28:E6:A9:AD:AB:1D`), adicionar app sem integração (Smart STB) e removê-lo
(sem chamar painel, só a linha local), Gerar/Mostrar/Copiar o M3U, e as
abas Novo Dispositivo/Dúvidas mostrando o conteúdo curado.

## Fases seguintes (ainda não implementadas)

- **Páginas de detalhe por app** (`[id]`) com instruções específicas do
  parceiro (NaTV 4100/4102, Fast pfast, Elite manual) — hoje só existe o
  bloco genérico "Novo dispositivo", sem página dedicada por app.
- **Filtro Financeiro/Aplicativos** na tela admin "Log do Portal"
  (`app/admin/auditoria/page.tsx`), replicando o padrão de
  `app/admin/dashboard-filter.tsx` — pra logar as ações reais que o Bloco 3
  já gera (configure/remove/add).
- **Pagamento avulso só do app**, sem renovação junto.
- Promover `/renew-beta` pra substituir `/renew` (ou redirecionar) quando
  o escopo acima estiver fechado.

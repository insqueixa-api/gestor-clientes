# Auditoria de performance (data-fetching) — checklist

## Rodada 2 (06/10/2026)

Motivo: muita coisa nova desde 24/08 (portal, aplicativos, Elite, cupons).

- **Medição real**: `pg_stat_statements` acumulava desde jan/2026 (misturava
  código já corrigido, ex: monitor da fila que fazia polling até 29/08).
  Backup salvo e estatísticas ZERADAS em 06/10/2026 — reler depois de uns
  dias de uso pra ver o comportamento atual (consultas `authenticated`/`anon`
  ordenadas por `total_exec_time` e `calls`).
- **Banco não é o gargalo hoje** (medido como admin logado, mediana de 5):
  `get_dashboard_iptv_bundle` 25ms, `get_dashboard_finance_bundle` 17ms,
  `get_clients_list_page` 23ms, `get_clients_filter_facets` 7ms. O custo
  estava nas idas e voltas EM SEQUÊNCIA nas rotas do portal.
- ✅ Validação de sessão do portal (toda rota): 2 idas → 1
  (`portal_validate_client`, docs/sql/portal_validate_client.sql), usada por
  `validatePortalClient` (com fallback pro caminho antigo).
- ✅ `apps/list`: 6 etapas sequenciais → 2 (pendências por client_id, cliente
  já com servidor, acesso "Adicionar" em paralelo).
- ✅ `get-prices`: até 8 idas → 2 (cliente + tabela + itens + preços +
  integração numa consulta aninhada; tabela padrão em paralelo). Conferido
  igual ao jeito antigo (Fast e Elite).
- ✅ `get-accounts`: 4 → 2 (`portal_session_accounts`: sessão + ids numa ida;
  pendências em paralelo com as contas).
- ✅ `pending-charges`: validação 2 → 1.
- ✅ `payment-status` (polling do PIX): pagamento + contas da sessão em paralelo.
- ✅ `create-payment`: validação 2 → 1 e tabela de preço junto com o cliente
  (−2 idas antes do PIX). Só leituras mudaram, nenhuma regra de cálculo.
- 🔎 Admin: Dashboard (2 RPCs em paralelo), Aplicativos (Promise.all + 2
  cargas avulsas paralelas), AdminShell (notificações 1x), polling (PIX
  progressivo 10s→5s, WhatsApp 80s/5min) — ok.
- ⚠️ **Lição**: o query builder do Supabase é PREGUIÇOSO — guardar
  `supabase.from(...)` numa variável NÃO dispara a consulta; só sai no
  await. Pra paralelizar de verdade: `Promise.all([...])` ou
  `Promise.resolve(builder)` na hora de criar.
- ⬜ Pendente: reler `pg_stat_statements` após uso real; `validate-coupon`
  ainda valida em 2 idas (só no clique de "Aplicar cupom", baixa frequência).

---

**Status: pente-fino completo (24/08/2026)** — todo `app/admin/**` (páginas +
modais) e o Portal do Cliente (`/renew`) foram auditados. Achados reais
corrigidos e no ar; o que já estava bom ficou documentado como tal (🔎)
pra não reauditar à toa numa próxima rodada.

**Achado importante (24/08/2026)**: Speed Insights mostrou várias rotas
"Poor" (>4s de LCP), incluindo `/admin` — que já usa o padrão-ouro (2 RPCs
em paralelo). Isso expôs que o gargalo real não era mais contagem de
queries: o Supabase roda em `sa-east-1` (São Paulo) e a Vercel, sem region
fixada, rodava tudo no padrão `iad1` (Virgínia, EUA) — toda consulta
pagava ida e volta EUA↔Brasil. Corrigido via `vercel.json`
(`regions: ["gru1"]`). Vale reavaliar as métricas do Speed Insights DEPOIS
desse deploy propagar antes de assumir que sobrou algo pra otimizar em
contagem de queries — pode ser que boa parte do "Poor" já resolva só com
isso.

Pente-fino em todo o sistema atrás do mesmo anti-padrão: fetch em onda
sequencial (um `useEffect`/`await` esperando o outro terminar sem
precisar) em vez de paralelo (`Promise.all`) ou, quando envolve resolver
"qual item fica selecionado" antes de buscar seus dados relacionados, um
RPC Postgres único (`LANGUAGE sql STABLE`, sem `SECURITY DEFINER`, tenant
via `auth.uid()`).

Padrão de referência: `docs/sql/condominio_page_bundle_rpc.sql` +
`app/admin/settings/condominio/page.tsx` (bundle simples) e
`docs/sql/client_detail_bundle_rpc.sql` + `app/admin/cliente/[id]/page.tsx`
(bundle com dependências condicionais).

Legenda: ✅ auditado e corrigido · 🔎 auditado, nada a corrigir · ⬜ ainda
não auditado

## Feito nesta rodada (24/08/2026)

- ✅ `app/admin/settings/condominio/page.tsx` — RPC bundle
- ✅ `app/admin/settings/condominio/edicoes/page.tsx` — RPC bundle
- 🔎 `app/admin/settings/condominio/edicoes/nova/page.tsx` — já era paralelo
- ✅ `app/admin/settings/profile/page.tsx` — Promise.all
- ✅ `app/admin/cliente/[id]/page.tsx` — RPC bundle + useEffect corrigido
- 🔎 `app/admin/cliente/page.tsx` (lista) — já otimizada (RPC único)
- ✅ `app/admin/auditoria/page.tsx` — Promise.all
- 🔎 `app/admin/page.tsx` (Dashboard) — já era o padrão-ouro (2 RPCs em
  paralelo), nada a fazer

## Financeiro Pessoal — concluído (24/08/2026)

- ✅ `app/admin/settings/financeiro_pessoal/page.tsx` — N+1 de
  `get_saldo_conta` por conta virou RPC bundle
  (`get_fin_saldos_contas`, roda em paralelo com `sincronizarRendimentos`
  já que os lançamentos sincronizados têm `conta_id: null`, então não
  colidem); loop sequencial de `resolve_notification` virou
  `Promise.allSettled`
- 🔎 `ModalAjusteSaldo.tsx` — já otimizado (recebe dados via props)
- 🔎 `ModalNovaConta.tsx` — já otimizado (só um insert)
- 🔎 `ModalNovaCategoria.tsx` — já otimizado (só um insert)
- 🔎 `ModalGerenciarItens.tsx` — já otimizado (recebe dados via props)
- 🔎 `ModalBaixa.tsx` — já otimizado (recebe dados via props, já usa
  Promise.allSettled)
- 🔎 `ModalEmprestimos.tsx` — já otimizado (Promise.all); achado menor de
  baixa prioridade: histórico/saldo por pessoa sem paginação — não
  urgente, baixo volume hoje

## Módulo Cliente (modais) — concluído (24/08/2026)

- 🔎 `app/admin/cliente/novo_cliente.tsx` — já otimizado (5 queries em
  Promise.all + WhatsApp fire-and-forget); achado cosmético de baixa
  prioridade (2 selects separados na tabela `servers` em efeitos
  diferentes) deixado como está, risco > ganho
- 🔎 `app/admin/cliente/recarga_cliente.tsx` — já otimizado

## Revendedor — concluído (24/08/2026)

- ✅ `app/admin/revendedor/page.tsx` — não trava mais `setRows`/loading
  esperando só o badge de agendamento (fire-and-forget)
- ✅ `app/admin/revendedor/[id]/page.tsx` — revenda + vínculos viraram
  Promise.all (histórico continua depois, depende dos ids dos vínculos)
- 🔎 `app/admin/revendedor/novo_revenda.tsx` — já otimizado
- ✅ `app/admin/revendedor/recarga_revenda.tsx` — achado igual ao da
  Cobrança: `await loadWhatsAppSessions()` (proxy pra VM) travava
  servidores/templates à toa; virou fire-and-forget + Promise.all
- 🔎 `app/admin/revendedor/[id]/vincular_servidor.tsx` — já otimizado

## Pendente — Gerenciador

- ⬜ `app/admin/gerenciador/aplicativo/page.tsx`
- ✅ `app/admin/gerenciador/cobranca/page.tsx` — achado real (24/08/2026,
  reportado pelo Márcio): os 2 fetches de perfil do WhatsApp
  (sessão 1/2, proxy pra VM com timeout de 12s) entravam no mesmo
  `Promise.all` que travava `setLoading(false)`, mesmo só sendo usados
  pelo seletor de sessão do modal — a lista de regras (já pronta rápido)
  ficava esperando a VM à toa. Corrigido: perfil do WhatsApp agora
  carrega em paralelo, fora do loading, via `loadWhatsAppSessionOptions`
  (helper já existente, reaproveitado em vez de reimplementado inline)
- 🔎 `app/admin/gerenciador/cobranca/ImpactListModal.tsx` — já otimizado
- 🔎 `app/admin/gerenciador/cobranca/AutomationWizard.tsx` — já otimizado
  (recebe auxData via props, sem refetch)
- ✅ `app/admin/gerenciador/cobranca/LogsModal.tsx` — clients + servers
  eram sequenciais sem depender um do outro → Promise.all
- 🔎 `app/admin/gerenciador/cobranca/shared.tsx` — só tipos, nada a auditar
- 🔎 `app/admin/gerenciador/mensagem/page.tsx` + `shared.tsx` — já otimizado
- 🔎 `app/admin/gerenciador/mensagem/EditorModal.tsx` — já otimizado
- 🔎 `app/admin/gerenciador/mensagem/PreviewModal.tsx` — já otimizado
- 🔎 `app/admin/gerenciador/pagamento/page.tsx` + `shared.tsx` — já otimizado
- 🔎 `app/admin/gerenciador/pagamento/HelpModal.tsx` — sem fetch, estático
- 🔎 `app/admin/gerenciador/pagamento/GatewayModal.tsx` — já otimizado
- 🔎 `app/admin/gerenciador/plano/page.tsx` — já otimizado (query única
  com nested select)
- 🔎 `app/admin/gerenciador/plano/plano_modal.tsx` — já otimizado; achado
  de baixa prioridade: loop sequencial de insert/update ao salvar tabela
  de preços (N+1 de escrita, não de leitura — só no save, não trava carga)
- 🔎 `app/admin/gerenciador/servidor/page.tsx` (lista) — já otimizado
  (6 queries em Promise.all)
- ✅ `app/admin/gerenciador/servidor/[id]/page.tsx` — 6 consultas
  independentes (servidor, movimentações, renovações, stats clientes
  ativos/arquivados, contagem de revendas) rodavam em sequência →
  Promise.all
- ✅ `app/admin/gerenciador/servidor/novo_servidor.tsx` — mesmo padrão
  Cobrança/Revendedor: integrações (banco) esperava sessão WhatsApp (VM)
  terminar → paralelo
- 🔎 `app/admin/gerenciador/servidor/recarga_servidor.tsx` — segunda busca
  (câmbio) só dispara de novo quando a moeda muda de verdade —
  dependência real, não anti-padrão, deixado como está
- 🔎 `app/admin/gerenciador/aplicativo/page.tsx` — já otimizado
  (Promise.all)

## Settings — concluído (24/08/2026)

- 🔎 `app/admin/settings/api-server/page.tsx` — já otimizado (Promise.all)
- 🔎 `app/admin/settings/api-server/app_integracao_modal.tsx` — já otimizado
- 🔎 `app/admin/settings/api-server/nova_integracao_modal.tsx` — já otimizado
- 🔎 `app/admin/settings/cupons/page.tsx` — já otimizado (Promise.all)
- 🔎 `app/admin/settings/cupons/client_picker.tsx` — já otimizado
- 🔎 `app/admin/settings/cupons/cupom_modal.tsx` — já otimizado
- ✅ `app/admin/settings/cupons/impact_preview.ts` — `coupon_redemptions`
  não dependia dos outros 2 fetches, entrou no mesmo Promise.all
- 🔎 `app/admin/settings/whatsapp/page.tsx` — já otimizado (não há mistura
  banco+VM aqui: a página é só VM, e já usa Promise.all entre as chamadas)
- 🔎 `app/admin/settings/whatsapp/VmMaintenanceModal.tsx` — já otimizado
- 🔎 `app/admin/settings/condominio/ModalCondominio.tsx` — já otimizado
- 🔎 `app/admin/settings/condominio/ModalAcao.tsx` — já otimizado
- 🔎 `app/admin/settings/condominio/CondominioFilterDropdown.tsx` — 100%
  presentational, sem fetch

## Agenda — concluído (24/08/2026)

- 🔎 `app/admin/agenda/page.tsx` + `shared.tsx` — já otimizado (loadData +
  loadWhatsAppSessions disparam sem await, já rodam em paralelo de propósito)
- 🔎 `app/admin/agenda/EditContatoModal.tsx` — já otimizado (sem useEffect
  de carga, form inicializa síncrono a partir da prop)
- 🔎 `app/admin/agenda/EnviarMensagemModal.tsx` — já otimizado (fetch só
  sob ação do usuário, sessões vêm via props)
- 🔎 `app/admin/agenda/ExcluirContatoModal.tsx` — já otimizado

## Testes — concluído (24/08/2026)

- 🔎 `app/admin/teste/page.tsx` — já otimizado (RPC única paginada,
  templates/sessões só carregam sob demanda ao abrir modal, stats
  auxiliares em segundo plano sem travar a tabela)

## Portal do cliente — concluído (24/08/2026)

- ✅ `app/renew/RenewClient.tsx` — achado de alto impacto: `validate-session`
  e `get-accounts` rodavam em sequência na tela mais importante do
  portal, mas nenhuma depende da outra (cada rota valida o
  session_token por conta própria) → Promise.all, corta a latência
  inicial quase pela metade
- 🔎 `app/renew/apps/[id]/AppDetailClient.tsx` — já otimizado (fetch único)

## Pendências residuais (baixa prioridade, não bloqueiam nada)

- `impact_preview.ts` (cupons) já resolvido; nenhum outro achado de baixa
  prioridade documentado acima foi corrigido de propósito (risco/esforço
  não compensava o ganho): `novo_cliente.tsx` (2 selects redundantes em
  `servers`), `plano_modal.tsx` (N+1 de escrita no save),
  `recarga_servidor.tsx` (dependência real, não anti-padrão)

## Baixa prioridade (páginas simples, provável sem fetch relevante)

- `app/login/page.tsx`, `app/reset-password/page.tsx`,
  `app/logout/page.tsx`, `app/page.tsx`, `app/redirect-kiwi/page.tsx`,
  `app/politica-de-privacidade/page.tsx`, `app/termos-de-uso/page.tsx`

# Auditoria de performance (data-fetching) — checklist

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
- ✅ `app/api/catalogo/detalhe/route.ts` — Promise.all
- ✅ `components/guia-tv/GuiaTVView.tsx` (deletar de todos) — Promise.all
- 🔎 `app/admin/gerenciador/guia-tv/page.tsx` + `components/guia-tv/*` —
  já bem otimizado no geral (useEffects paralelos, paginação nas listas
  grandes); só achado de cache de imagem de EPG fica pendente, baixa
  prioridade
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
- ⬜ `app/admin/gerenciador/plano/page.tsx` — **não auditado** (agente
  bateu no limite de sessão do dia, 24/08/2026 — refazer)
- ⬜ `app/admin/gerenciador/plano/plano_modal.tsx` — idem
- ⬜ `app/admin/gerenciador/servidor/page.tsx` — idem
- ⬜ `app/admin/gerenciador/servidor/[id]/page.tsx` — idem (candidato forte:
  provavelmente fala com painel externo do provedor IPTV, mesma família
  do achado da Cobrança/Revendedor)
- ⬜ `app/admin/gerenciador/servidor/novo_servidor.tsx` — idem
- ⬜ `app/admin/gerenciador/servidor/recarga_servidor.tsx` — idem
- ⬜ `app/admin/gerenciador/aplicativo/page.tsx` — idem

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

## Pendente — Agenda (não auditado, agente bateu no limite de sessão)

- ⬜ `app/admin/agenda/page.tsx` + `shared.tsx`
- ⬜ `app/admin/agenda/EditContatoModal.tsx`
- ⬜ `app/admin/agenda/EnviarMensagemModal.tsx` (candidato forte: manda
  mensagem via WhatsApp, mesma família do achado da Cobrança)
- ⬜ `app/admin/agenda/ExcluirContatoModal.tsx`

## Pendente — Testes (não auditado, agente bateu no limite de sessão)

- ⬜ `app/admin/teste/page.tsx`

## Pendente — Portal do cliente (não auditado, agente bateu no limite de sessão)

- ⬜ `app/renew/page.tsx` (home do portal — prioridade alta, é a área
  pública voltada pro cliente final)
- ⬜ `app/renew/apps/[id]/page.tsx`
- 🔎 `app/renew/guia-tv/page.tsx` — coberto na varredura do Guia TV, sem
  achados

## Baixa prioridade (páginas simples, provável sem fetch relevante)

- `app/login/page.tsx`, `app/reset-password/page.tsx`,
  `app/logout/page.tsx`, `app/page.tsx`, `app/redirect-kiwi/page.tsx`,
  `app/politica-de-privacidade/page.tsx`, `app/termos-de-uso/page.tsx`

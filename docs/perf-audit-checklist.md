# Auditoria de performance (data-fetching) — checklist

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

## Pendente — módulo Cliente

- ⬜ `app/admin/cliente/novo_cliente.tsx` (modal criar/editar cliente)
- ⬜ `app/admin/cliente/recarga_cliente.tsx` (modal recarga)

## Pendente — Revendedor

- ⬜ `app/admin/revendedor/page.tsx`
- ⬜ `app/admin/revendedor/[id]/page.tsx`
- ⬜ `app/admin/revendedor/novo_revenda.tsx`
- ⬜ `app/admin/revendedor/recarga_revenda.tsx`
- ⬜ `app/admin/revendedor/[id]/vincular_servidor.tsx`

## Pendente — Gerenciador

- ⬜ `app/admin/gerenciador/aplicativo/page.tsx`
- ⬜ `app/admin/gerenciador/cobranca/page.tsx` + `shared.tsx`
- ⬜ `app/admin/gerenciador/cobranca/ImpactListModal.tsx`
- ⬜ `app/admin/gerenciador/cobranca/AutomationWizard.tsx`
- ⬜ `app/admin/gerenciador/cobranca/LogsModal.tsx`
- ⬜ `app/admin/gerenciador/mensagem/page.tsx` + `shared.tsx`
- ⬜ `app/admin/gerenciador/mensagem/EditorModal.tsx`
- ⬜ `app/admin/gerenciador/mensagem/PreviewModal.tsx`
- ⬜ `app/admin/gerenciador/pagamento/page.tsx` + `shared.tsx`
- ⬜ `app/admin/gerenciador/pagamento/HelpModal.tsx`
- ⬜ `app/admin/gerenciador/pagamento/GatewayModal.tsx`
- ⬜ `app/admin/gerenciador/plano/page.tsx`
- ⬜ `app/admin/gerenciador/plano/plano_modal.tsx`
- ⬜ `app/admin/gerenciador/servidor/page.tsx`
- ⬜ `app/admin/gerenciador/servidor/[id]/page.tsx`
- ⬜ `app/admin/gerenciador/servidor/novo_servidor.tsx`
- ⬜ `app/admin/gerenciador/servidor/recarga_servidor.tsx`

## Pendente — Settings

- ⬜ `app/admin/settings/api-server/page.tsx`
- ⬜ `app/admin/settings/api-server/app_integracao_modal.tsx`
- ⬜ `app/admin/settings/api-server/nova_integracao_modal.tsx`
- ⬜ `app/admin/settings/cupons/page.tsx`
- ⬜ `app/admin/settings/cupons/client_picker.tsx`
- ⬜ `app/admin/settings/cupons/cupom_modal.tsx`
- ⬜ `app/admin/settings/whatsapp/page.tsx`
- ⬜ `app/admin/settings/whatsapp/VmMaintenanceModal.tsx`
- ⬜ `app/admin/settings/condominio/ModalCondominio.tsx` (sem fetch de
  lista, baixo risco — conferir rápido só por completude)
- ⬜ `app/admin/settings/condominio/ModalAcao.tsx`
- ⬜ `app/admin/settings/condominio/CondominioFilterDropdown.tsx`

## Pendente — Agenda

- ⬜ `app/admin/agenda/page.tsx` + `shared.tsx`
- ⬜ `app/admin/agenda/EditContatoModal.tsx`
- ⬜ `app/admin/agenda/EnviarMensagemModal.tsx`
- ⬜ `app/admin/agenda/ExcluirContatoModal.tsx`

## Pendente — Testes

- ⬜ `app/admin/teste/page.tsx`

## Pendente — Portal do cliente (público)

- ⬜ `app/renew/page.tsx`
- ⬜ `app/renew/apps/[id]/page.tsx`
- 🔎 `app/renew/guia-tv/page.tsx` — coberto na varredura do Guia TV, sem
  achados

## Baixa prioridade (páginas simples, provável sem fetch relevante)

- `app/login/page.tsx`, `app/reset-password/page.tsx`,
  `app/logout/page.tsx`, `app/page.tsx`, `app/redirect-kiwi/page.tsx`,
  `app/politica-de-privacidade/page.tsx`, `app/termos-de-uso/page.tsx`

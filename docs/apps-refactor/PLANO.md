# Refactor de Aplicativos — Plano (30/09/2026)

Objetivo: tirar do catálogo o "aplicativo parceiro por servidor", ranquear
os melhores apps em níveis, trazer quase todo o catálogo da Appativa, e
trocar o "Adicionar aplicativo" (admin + portal) por uma vitrine estilo
appativa.store — tela cheia no celular, modal grande no computador —
mantendo o filtro por aparelho.

Fora de escopo agora: mudar as APIs de ativação existentes (Quick depois).

---

## 1. Retrato de hoje (levantado no banco em 30/09/2026)

**Catálogo (`apps`) — 42 apps**

| Tipo | Qtd | Observação |
|---|---|---|
| `paid` | 17 | 14 já ligados à Appativa (`appativa_app_id`) |
| `free` | 11 | 6 via GerenciaApp — **IBO Revenda tem 95 clientes ativos** |
| `partnership` | 10 | presos a servidor (`partner_server_id`) |
| sem tipo | 4 | Brasil IPTV (4 clientes), HD Player, XCLOUD, Blessed |

**Apps de parceria em uso (29 clientes ativos)**

| App | Servidor | Clientes ativos |
|---|---|---|
| Quick Player | Elite | 11 |
| TOP TV | NaTV | 7 |
| Quick Player Pro | Elite | 4 |
| Lazer Play | Fast | 3 |
| Fun Play | Fast | 2 |
| Flex Play | NaTV | 1 |
| Foco Player | Fast | 1 |
| qplay, Elite P2P, Elite G2 | Elite | 0 (podem sair direto) |

**Vínculo cliente↔app (`client_apps`)**: `field_values` (jsonb: MAC, key,
vencimento, obs…). `license_paid_until` existe mas **nunca é usado** (0
linhas) — o vencimento real mora no campo `date` dentro de `field_values`.

**Appativa (`api.ativeapp.com/api/listar-aplicativos`)** — 186 apps. Hoje
só guardamos `id, uuid, nome, valor` em `api_integrations.catalog_cache`,
mas a API devolve ~60 campos:

| Campo | Preenchido | Uso no refactor |
|---|---|---|
| `logo_do_app` | 186/186 | ícone automático (copiar pro R2) |
| `modulo` | — | = nosso `integration_type` (ex: `IBOPLAYER`) |
| `plano` | 186/186 | período da licença (ANUAL…) |
| `valor` | 186/186 | custo em créditos |
| `link_app` | vários | site onde o cliente pega MAC/Key |
| `mac_e_key`, `is_device_id` | 7 | quais campos o app pede |
| `deletado` | 9 | removido lá — esconder aqui |
| `descricao`, `categoria`, `avaliacao` | 8–18 | pouco preenchido |
| `androidtv/samsung/lg/roku/microsoft/apple_link`, `codigo_downloader` | 12–18 | links por plataforma |
| `banner_1_detalhe`, `anner_2_detalhe` (sic) | vários | prints pra tela de Detalhes |
| `classe` (A/B) | 59 | classificação deles — referência pros nossos níveis |

---

## 2. Decisões do Márcio (30/09/2026)

1. **Clientes dos apps de parceria (29)** — continuam como estão, **sem
   cobrança**. Em vez de migrar, montar rotas de **configuração e checagem
   de vencimento** desses apps (hoje o vencimento deles nem aparece) — fase
   10. Se der problema, ele repassa só o custo da ativação ou paga o 1º ano.
   O *catálogo* deixa de oferecer "app de parceria por servidor" pra
   escolhas novas; os vínculos existentes continuam valendo.
2. **Apps do GerenciaApp** (IBO Revenda, IBONew, GPC Pro, UNI/VU Revenda,
   Zone X) — **continuam gratuitos, inclusive a renovação** (custo fixo de
   R$ 30/mês dele, não compensa repassar).
3. **Classificação por estrelas** (vários apps por nível): ★★★★★ a ★
   (`apps.tier` = quantidade de estrelas, 5 = melhor). Os nomes "Top dos
   Tops / Tops / Bons…" foram só exemplo — o Márcio preferiu estrelas.
   + categoria especial **Configuração manual** (sem integração nenhuma,
   precisa configurar à mão) — derivada, não é nível.
4. **Descrição / Detalhes** — usa a `descricao` da Appativa como padrão;
   quando ele edita, a dele passa a valer (override) e a sincronização
   nunca mais sobrescreve.
5. **Importação da Appativa** — primeiro um **relatório** dos apps deles que
   ainda não estão aqui: nome + valor, ordenado por valor (menor → maior) e
   depois alfabético.
6. **Editor de texto rico** — biblioteca de verdade (negrito, itálico,
   marcadores, link), reaproveitada em 3 lugares — fase 8.
7. **Histórico permanente de ativações** — fase 9.
8. **Portal** — "Meus Aplicativos" fica **ligado** até o dia do refactor. A
   chave pra desligar já existe: `lib/apps/portal-apps-flag.ts`
   (`PORTAL_APPS_DISABLED = true` desliga card, página de detalhe e as 7
   rotas que alteram dados).

### Referência visual: appativa.store (print headless, 30/09/2026)
- Hero + **"Top 10 Mais Vendidos"** (carrossel com número grande 1, 2, 3…).
- "Aplicativos Disponíveis" com busca; apps em **grupos alfabéticos**
  (A–E, F–I, J–N, O–S, T–Z), cada grupo um **carrossel horizontal** com
  setas e bolinhas de página.
- Card: logo, nome, badge "⚡ Ativação Instantânea", preço grande +
  "LICENÇA ANUAL", botões **Detalhes** (cinza) e **Ativar** (cor), ícone de
  compartilhar no canto (no nosso vira o selo do nível).
- Celular: mesmos cards, 2 por linha dentro do carrossel.
- Abre com modal de termos ("não vendemos conteúdo") — não copiar.

---

## 3. Modelo de dados (fase 1)

Colunas novas em `apps` (migração aditiva, nada quebra):

- `tier smallint` — 1 Top dos Tops, 2 Tops, 3 Bons, 4 Intermediários,
  5 Aceitáveis, `null` sem nível. "Configuração manual" = derivado (sem
  integração) ou `tier = 9` se ele quiser marcar à mão.
- `tier_order int` — ordem dentro do nível.
- `details_html text` — Detalhes editado por ele (HTML **sanitizado no
  servidor**, allowlist: `b strong i em u a[href] ul ol li p br h3`; `a`
  sempre `target=_blank rel=noopener`).
- `appativa_description text` — descrição importada (usada quando
  `details_html` está vazio).
- `store_link text` — site do app (`link_app`).
- `platform_links jsonb` — `{androidtv, samsung, lg, roku, microsoft, apple, downloader_code}`.
- `appativa_synced_at timestamptz`.

"Ativação instantânea" **não vira coluna** — é derivado:
`appativa_app_id is not null OR integration_type com ativação automática`
(mesma regra do `has_integration` que o portal já calcula).

Saem só no fim (fase 6): `partner_server_id` / `access_code` /
`cost_type = 'partnership'` **do catálogo** — os 29 vínculos continuam
funcionando (decisão 1), então a limpeza é das telas de escolha, não dos
dados desses clientes.

Não esquecer:
- ícone novo vai pro R2 pasta `apps` → coberto por `_r2_refs_blob()` e
  `lib/r2-folders.ts` (feito em 30/09).
- `details_html` renderizado no portal → **nunca** `dangerouslySetInnerHTML`
  sem o mesmo sanitizador.

---

## 4. Fases

### Fase 1 — Banco
- SQL da seção 3 (`docs/sql/apps_refactor_fase1.sql`).
- Rotas que listam catálogo devolvem `tier`, `details_html`/`appativa_description`, `store_link`, `platform_links`.

### Fase 2 — Relatório + importação da Appativa
- `app/api/integrations/appativa/list-apps/route.ts`: guardar os campos extras (hoje descarta tudo menos 4).
- **Relatório** (decisão 5): apps da Appativa fora do nosso catálogo — nome, valor, ordenado valor ↑ e nome.
- Tela de importação: lista com checkbox, "já importado", "removido na Appativa".
- Ao importar: cria/atualiza `apps` (nome, `appativa_app_id`, `integration_type = modulo`, período, `store_link`, `platform_links`, `appativa_description`, campos MAC/Key conforme `mac_e_key`/`is_device_id`) e **copia o logo pro R2**.
- Nunca sobrescreve o que ele editou (preço, Detalhes, nível, nome) — só preenche vazio.

### Fase 3 — Admin do catálogo (`app/admin/gerenciador/aplicativo/page.tsx`)
- Modal de edição simplificado: some Parceria / servidor parceiro / código de acesso / aba de custo.
- Fica: nome, ícone, aparelhos, preço + período (grátis continua possível pro GerenciaApp), **nível**, integração, campos (MAC/Key/…), ativo/descontinuado, **Detalhes** (editor da fase 8).
- Grade da página agrupada por nível, com arrastar pra ordenar dentro do nível.

### Fase 4 — Nova vitrine compartilhada (substitui `components/apps/AppPickerModal.tsx`)
`components/apps/AppStore.tsx`, usada no admin (`novo_cliente.tsx`) e no
portal (`RenewClient.tsx`):
- **Celular**: tela cheia (sheet de baixo pra cima, botão voltar). **Computador**: modal grande (`max-w-6xl`, ~90vh).
- Topo: busca + chips de aparelho (Samsung/LG, Android TV, Fire TV, Roku, Celular, iPhone, Computador, Xbox) — **mantém compatibilidade por plataforma**, com "Todos".
- Seções por nível (Top dos Tops → Aceitáveis), depois Configuração manual; dentro de cada seção, carrossel ou grade.
- Card: logo, nome, **selo do nível no canto**, badge **⚡ Ativação Instantânea**, **preço/período** (ou "Grátis"), **Detalhes** e botão principal:
  - portal: **Configurar e ativar**
  - admin: **Adicionar ao cliente**
- **Detalhes**: sheet/modal com o texto rico, links por plataforma/Downloader, prints.
- Sai: abas "Pagos/Parceiros", trava por servidor (`clientServerId`), "(Gratuito)".

### Fase 5 — Fluxo depois de escolher o app
- Portal: "Configurar e ativar" → campos do app (MAC, Key…) **pré-preenchidos se já existirem** (vínculo atual ou histórico da fase 9), editáveis → pagamento/ativação que já existe (`apps/add`, `renew-payment`, Appativa). **APIs de ativação não mudam.**
- Admin: mesmo componente; ao adicionar segue pro `AppRequestModal`/campos como hoje.
- `app/renew/apps/[id]/AppDetailClient.tsx`: Detalhes novo no lugar de `portal_setup_instructions` (manter variáveis `{codigo}` se ainda usadas).

### Fase 6 — Limpeza do código de parceria no catálogo
- Apagar do catálogo os 3 sem uso (qplay, Elite P2P, Elite G2).
- Tirar a lógica de parceria das telas de escolha/edição (os 29 vínculos continuam):
  `app/admin/cliente/novo_cliente.tsx`, `app/admin/cliente/page.tsx`,
  `app/admin/gerenciador/aplicativo/page.tsx`, `app/admin/teste/page.tsx`,
  `app/api/admin/aplicativo/sugerir-instrucoes/route.ts`,
  `app/api/client-portal/apps/{add,catalog,detail,list}/route.ts`,
  `app/renew/RenewClient.tsx`, `components/apps/AppPickerModal.tsx` (sai),
  `lib/apps/orchestration.ts`, `lib/apps/types.ts`.
  Conferir quem lê `cost_type`: `renew-gerenciaapp`, `gerenciaapp/renew-free`,
  `eligible-coupon`, `renew-payment`, `request-setup`,
  `components/alerts/ClientAlertBell.tsx`, `lib/client-portal/app-renewal-charges.ts`.

### Fase 7 — Depois (fora deste ciclo)
- Quick Player / Quick Player Pro (`QUICKPLAYER`): revisar a API.

### Fase 8 — Editor de texto rico compartilhado
Um componente (`components/ui/RichTextEditor.tsx`), dois modos:
- **HTML** (Detalhes do app, textos do Condomínio): Negrito, Itálico,
  Sublinhado, Marcadores, Lista numerada, Link; salva HTML e o servidor
  sanitiza. Biblioteca: TipTap (versão estável, nunca RC/beta).
- **WhatsApp** (templates de mensagem): seleciona o texto + botão → envolve
  com o símbolo do WhatsApp: negrito `*texto*`, itálico `_texto_`, tachado
  `~texto~`, monoespaçado com 3 crases, lista `- `, citação `> `.
  ⚠️ **WhatsApp não tem sublinhado** — nenhum símbolo faz isso; o botão não
  aparece nesse modo. Textarea com barra própria (sem biblioteca).

### Fase 9 — Histórico permanente de ativações (sobrevive a cliente apagado)
Tabela nova (ex.: `app_activations`), uma linha por ativação/renovação:
- app (id + **nome e integração em texto**), cliente (id com
  `on delete set null` + nome/login em texto), MAC / device key / demais
  campos, vencimento, valor, moeda, referência do pagamento
  (`client_portal_payments.id` / Ref MP), origem (portal, admin, Appativa,
  GerenciaApp), data.
- Nunca apagada junto com o cliente.
- Busca por MAC/key pra **reaproveitar ativação** em outro cliente, com o
  vencimento que ainda tem.
- Base: generalizar o registro do GPC Roku (`lib/apps/gpc-roku-registry.ts`)
  e o `client_app_activity_log`.
- Backfill: `client_apps.field_values` + pagamentos `payment_type = app_renewal`.

### Fase 10 — Rotas de configuração/vencimento pros apps de parceria (decisão 1)
Quick Player, Quick Player Pro, TOP TV, Lazer, Fun, Flex, Foco — no mesmo
padrão das integrações existentes (`lib/integrations`,
`/api/admin/apps/check-validity`), pra o vencimento aparecer no admin e
no portal.

---

## 5. Ordem sugerida de entrega (cada uma testável sozinha em produção)

1. Fase 1 + Fase 3 (admin já cadastra nível, preço e Detalhes — nada muda pro cliente).
2. Fase 2 (relatório, depois importação).
3. Fase 4 + 5 no **admin** primeiro (testa o fluxo inteiro sem expor ao cliente).
4. Desliga o portal (`PORTAL_APPS_DISABLED = true`) → Fase 4 + 5 no **portal** → religa.
5. Fase 6 (limpeza).
6. Fases 8, 9 e 10 em paralelo quando fizer sentido (editor, histórico, rotas dos parceiros).

---

## 6. Andamento

- **30/09/2026 — Fase 1 (parcial) + página do catálogo**: colunas `apps.tier` (1–5) e `apps.tier_order` criadas (`docs/sql/apps_refactor_fase1_tier.sql`, aplicado). `/admin/gerenciador/aplicativo` reorganizada: sem abas/grupos por custo nem filtros de custo/parceiro/tecnologia; lista por nível (💎 Top dos Tops → ✅ Aceitáveis), depois "Sem classificação", "🔧 Configuração manual" (derivado: sem integração), "Parcerias antigas" e "Descontinuados" recolhidos. Card limpo (ícone, nome, preço, ⚡ Automático/🔧 Manual, aparelhos em ícone) com seletor de nível no próprio card. Modal de edição ainda intocado — próximo passo (Fase 3).
- Também feitos fora da ordem: editor rico (Fase 8, WhatsApp + Condomínio), carrinho de apps no portal, cupom por instalação.
- **30/09/2026 — card do catálogo, 2ª versão** (feedback do Márcio): estrelas sempre 5 (acesas/apagadas) no canto superior direito, clicáveis (abre seletor); ⚙️ Automático = tem integração de configuração; ⚡ raios = quem ativa/renova (DupleCast, AtivaApp, GerenciaApp — ordem de prioridade, renewal_source='appativa' inverte); preço no canto inferior direito; aparelhos com logos reais (`components/apps/DeviceBadges.tsx`, Simple Icons CC0 recortados; Fire TV/Xbox/PC via lucide porque Simple Icons não tem Amazon/Microsoft).
- **A decidir (modal/portal)**: nova lista de aparelhos — Samsung e LG separados, Roku, Xbox, Computador, Android, iPhone, Vega OS (Fire Stick novo) e um popup de marcas de TV (TCL, Philips, AOC…) que leva a Android ou Roku. "Ver Informações" estilo appativa.store (downloads por plataforma, código Downloader) — usa `platform_links` da Fase 1.

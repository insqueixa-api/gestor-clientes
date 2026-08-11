# Tela: Portal — Guia de TV (`/renew/guia-tv`)

Arquivos: [app/renew/guia-tv/page.tsx](../../app/renew/guia-tv/page.tsx) (wrapper fino — lê `servidor`/`conta` da URL e `cp_session` do `sessionStorage`), [components/guia-tv/GuiaTVView.tsx](../../components/guia-tv/GuiaTVView.tsx) (~5.270 linhas, **mesmo componente** usado em [gerenciador-guia-tv.md](gerenciador-guia-tv.md))

## O que é

Grade de canais ao vivo, catálogo VOD (filmes/séries) e "Jogos do Dia" — versão para o cliente final do mesmo componente do admin. A diferença de comportamento é inteiramente controlada pela prop `modoCliente`: o admin renderiza `<GuiaTVView />` sem props (`modoCliente` undefined = todos os controles administrativos liberados); o portal renderiza `<GuiaTVView servidorFiltro modoCliente sessionToken contaId />`.

## Verificação de segurança — `modoCliente` esconde os controles administrativos?

Esta era a pergunta em aberto da auditoria do admin. **Verificação sistemática de todas as 26 ocorrências de `modoCliente` no componente, com cada botão/ação administrativa rastreado até sua raiz de renderização:**

| Controle administrativo | Gating | Veredito |
|---|---|---|
| Dropdown "Sincronizar" (catálogo, grade Claro, jogos, dados de uso, sugestões admin) | `{!modoCliente && (...)}` | OK |
| Modal de sync de catálogo (ELITE/NATV/FAST + TMDB + limpeza) | só abre via botão já escondido acima | OK |
| "Corrigir TMDB" / deletar título / badge TMDB no modal de detalhe | `{!modoCliente && ...}` em cada ponto | OK |
| Lista "Disponível em (servidores)" no modal de detalhe | `{!modoCliente && ...}` | OK |

**[CORRIGIDO] Um botão administrativo escapava do gating por `modoCliente`.** O componente `AbaCanais` (aba "Canais") recebia `onRetrySync={handleSync}` incondicionalmente — se a grade EPG falhasse ao carregar do R2 (o que pode acontecer também para o cliente, não só para o admin), aparecia um botão **"Tentar Sincronizar"** que chamava o mesmo endpoint administrativo (`POST /api/epg/sync/sync-claro`) usado pelo dropdown escondido, e a mensagem de erro instruía literalmente *"Rode o botão 'Sync EPG Grade'"* — linguagem interna vazando pro cliente final.

A rota em si já exigia sessão de admin (`supabase.auth.getUser()` ou cron secret) e recusava a sessão de portal do cliente com 401 — **não havia vazamento de dado real, o clique simplesmente não fazia nada** — mas violava o contrato "modoCliente esconde tudo que é admin" (só a API protegia, não a UI) e mostrava terminologia interna. Corrigido em duas frentes:
1. `onRetrySync` agora só é passado quando `!modoCliente`.
2. A mensagem de erro da grade indisponível agora é neutra ("Grade de canais indisponível no momento. Tente novamente mais tarde.") quando `modoCliente` está ativo, em vez de instruir uma ação administrativa.

## De onde vêm os dados

- **EPG/Jogos**: JSONs públicos no Cloudflare R2 (`epg/epg_claro.json`, `epg/jogos_dia.json`), buscados direto do browser sem autenticação — mesmo padrão do admin.
- **Catálogo VOD**: `catalog_master`/`catalog_availability`/`catalog_episodes`, view `vw_catalog_novidades`, via `/api/catalogo/*` (service role).
- **Sugestões de conteúdo**: `content_suggestions`, `content_suggestion_requests`.
- **Log de acesso**: `guia_tv_access_log`.

## Rotas de API chamadas pelo cliente final

| Rota | Validação de sessão |
|---|---|
| `/api/client-portal/guia-tv/log-access` | `session_token` + `client_portal_sessions` |
| `/api/client-portal/guia-tv/sugestao` (POST/DELETE) | `session_token` + confirma que `conta` pertence ao whatsapp da sessão |
| `/api/client-portal/guia-tv/sugestao/historico` | idem |
| `/api/client-portal/guia-tv/sugestao/buscar` | só `session_token` (autocomplete de catálogo público, por design) |
| `/api/catalogo/{novidades,categorias,titulos,busca}` | **nenhuma** — rotas públicas por design (catálogo é global, não por tenant, mesmo padrão das rotas do admin) |

Todas as rotas administrativas (`sync-claro`, `sync-jogos`, `sync-catalog/*`, `sync-tmdb`, `catalogo/titulo` DELETE, `tmdb-aplicar`) exigem sessão de admin ou cron secret — mesmo que a UI vazasse um botão (como no achado corrigido acima), a API já bloqueava.

## Achado de baixo risco (não alterado)

1. **Seletor de servidor (ELITE/NATV/FAST/TODOS) no catálogo é gated por `servidorAdmin === "TODOS"`, não por `modoCliente` diretamente.** Normalmente coincide (o link para o Guia de TV só é mostrado com `?servidor=X` quando a conta tem servidor mapeado), mas se um cliente acessar `/renew/guia-tv?conta=Y` sem o parâmetro `servidor` (URL manual, ou conta sem servidor mapeado), `servidorFiltro` cai no padrão `"TODOS"` e o cliente passa a ver o seletor completo, podendo navegar catálogo de servidores que não são o seu. Não é vazamento de dado sensível (catálogo é conteúdo genérico), mas quebra a intenção "cliente só vê o catálogo do seu servidor" já expressa em outro comentário do próprio código. Não alterado — prefiro confirmar se vale a pena depender de outro sinal além do parâmetro de URL antes de mexer.

## Sugestão de melhoria

- Rotas `/api/catalogo/{novidades,categorias,titulos,busca}` são totalmente públicas e sem rate limit — decisão de design já tomada (catálogo global), mas fica aberto a scraping por terceiros que descubram a URL.

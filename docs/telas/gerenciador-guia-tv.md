# Tela: Gerenciador de Guia TV (`/admin/gerenciador/guia-tv`)

Arquivo: [app/admin/gerenciador/guia-tv/page.tsx](../../app/admin/gerenciador/guia-tv/page.tsx) — wrapper de 8 linhas que só renderiza [components/guia-tv/GuiaTVView.tsx](../../components/guia-tv/GuiaTVView.tsx) (~5.270 linhas), o **mesmo componente** usado no Portal do Cliente (`/renew/guia-tv`, ver [portal-guia-tv.md](portal-guia-tv.md)), aceitando props (`servidorFiltro`, `modoCliente`, `sessionToken`, `contaId`) que o admin simplesmente não passa.

## O que é

Cobre três funções: grade de canais ao vivo com EPG (Claro), catálogo VOD (filmes/séries dos servidores Elite/NaTV/Fast + enriquecimento TMDB) e "Jogos do Dia" com transmissão por canal.

## De onde vêm os dados

- **Grade de canais/EPG**: não lê Supabase no client — busca o JSON pronto direto do Cloudflare R2 (`epg/epg_claro.json`), gerado pela rota de sync a partir de `epg_canais`/`epg_programas`.
- **Jogos do dia**: mesmo padrão, `epg/jogos_dia.json`, gerado a partir de `jogos_dia`.
- **Catálogo VOD**: via `/api/catalogo/*`, tocando `catalog_master`, `catalog_availability`, `catalog_episodes`, `catalog_stats_por_servidor`, views `vw_catalog_novidades`/`vw_catalog_categorias`, e `content_suggestions`/`content_suggestion_requests`.

## Rotas de API chamadas

- `GET /api/epg/sync/sync-jogos` — botão "Sincronizar Jogos". Confirmado: aciona a rota que busca jogos de hoje+amanhã em `webws.365scores.com`, filtra por `hasTVNetworks`, remove canais de uma lista bloqueada fixa, faz upsert em `jogos_dia` e sobe o JSON pro R2.
- `POST /api/epg/sync/sync-claro` — sync principal de EPG (programação Claro RJ+SP).
- `GET/POST /api/epg/sync-catalog/{elite,natv,fast}` — status e disparo de sync de catálogo VOD por servidor.
- `GET/POST /api/epg/sync-tmdb` — enriquecimento de metadados via TMDB, em lotes de 50 com 2s de intervalo (anti rate-limit).
- `GET/POST /api/catalogo/limpar` — preview e execução de limpeza de títulos órfãos.
- `/api/catalogo/{detalhe,tmdb-aplicar,titulo,novidades,categorias,sugestoes}`, `/api/epg/sync/imagem`.
- `/api/client-portal/guia-tv/*` — usadas mesmo na visão admin, porque `GuiaTVView` é o mesmo componente do Portal sem distinguir contexto em vários pontos.

## Integrações externas

Cloudflare R2, Claro (`programacao.claro.com.br`, scraping de API pública sem chave), `webws.365scores.com` (API não-oficial de jogos, sem autenticação), TMDB, servidores IPTV Elite/NaTV/Fast.

## Achados e correções aplicadas

1. **[CORRIGIDO] `GET /api/catalogo/limpar` (preview de limpeza) não exigia autenticação**, diferente do `POST` (que exige cron secret ou sessão). Baixo risco (só retorna contagens agregadas, sem dado sensível), mas destoava do padrão do restante do arquivo e das outras rotas de sync. Adicionada a mesma checagem de sessão/cron que o `POST` já tinha.

## Achado que precisa de verificação (importante, não confirmado nesta auditoria)

2. **Não confirmado se `modoCliente` de fato esconde os controles administrativos (sync EPG, sync catálogo, sync jogos, limpar catálogo, TMDB) quando `GuiaTVView` é renderizado no Portal do Cliente.** O componente é gigante (~5.270 linhas) e é compartilhado entre admin e portal sem separação clara de arquivo — a auditoria da tela do Portal (ver [portal-guia-tv.md](portal-guia-tv.md)) verificou isso especificamente.

## Sugestão de melhoria (não alterada)

- A grade de canais fica "presa" ao último JSON gerado; se o sync falhar no meio, o card mostra um erro genérico ("Grade de canais não encontrada localmente") sem indicar se é falha de sync ou ausência do arquivo — um diagnóstico mais específico ajudaria a debugar mais rápido.

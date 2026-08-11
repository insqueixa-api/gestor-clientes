# Tela: Gerenciador de Aplicativo (`/admin/gerenciador/aplicativo`)

Arquivo: [app/admin/gerenciador/aplicativo/page.tsx](../../app/admin/gerenciador/aplicativo/page.tsx) (~1.900 linhas, sem componentes filhos — modais embutidos no próprio arquivo)

## O que é

CRUD do catálogo de aplicativos (IBO Player, DupleCast etc.) que os clientes usam para assistir. Cada app define nome, ícone, tipo de custo (gratuito/pago/parceria), tecnologia, dispositivos compatíveis, campos de cadastro personalizados, instruções de configuração exibidas no Portal do Cliente, e opcionalmente uma "integração automática" com o painel do fornecedor.

## De onde vêm os dados

- **`apps`** — CRUD completo, filtrado por `tenant_id`.
- **`app_integrations`** (só leitura aqui) — usada só para saber se a integração de um app já foi configurada (badge "Configurar API" vs. "Integrado"). A configuração de fato acontece em **outra tela** ([settings/api-server](settings-api-server.md)) — não há link/botão nesta tela levando até lá.
- **`servers`** (só leitura) — combo "Servidor parceiro" e agrupamento de apps do tipo parceria.

## Rotas de API chamadas

- `POST /api/upload/presign` — URL pré-assinada Cloudflare R2 para upload do ícone do app. Só exige sessão válida, sem checar tenant/role — é o endpoint genérico de upload do produto, não exclusivo desta tela.
- `PUT <presignedUrl>` — upload direto pro bucket R2, fora do Next.js.

## Integrações externas

Cloudflare R2 (armazenamento do ícone). As integrações automáticas de verdade (GerenciaApp, DupleCast, IBO Pro, Quick Player, MessiTV, BOB Player, IBO Player, IPTV Duplex, IPTV Playerio, Duplex TV, ClouDDy, Ninja Player) são configuradas em `settings/api-server`, não aqui.

## Modais

Modal único de criação/edição (`Modal` de `components/ui/Modal.tsx`, renderizado inline).

## Achados (não alterados — baixo risco, sugestões de limpeza)

1. O bloco de "Integração automática" só aparece se `isRootTenant` (hardcoded `true` no código) e outra condição de tenant — como `isRootTenant` está fixo, é efetivamente código morto, vestígio do modelo multi-tenant já desativado (ver memória do projeto sobre a limpeza de maio/2026). Não quebra nada hoje, mas pode confundir manutenção futura.
2. `/api/upload/presign` não checa tenant/role (só sessão válida) — baixo risco (storage não é dado sensível), mas destoa do padrão do resto do projeto.
3. Badge "Configurar API" não tem link direto para a tela onde a configuração acontece de fato.

## Sugestões de melhoria

- Link direto da badge "Configurar API" → `/admin/settings/api-server`.
- Remover o vestígio `isRootTenant` se de fato não há mais plano de reativar multi-tenant.

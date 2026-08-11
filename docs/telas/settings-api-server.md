# Tela: Settings › API/Server (`/admin/settings/api-server`)

Arquivos: [page.tsx](../../app/admin/settings/api-server/page.tsx), [nova_integracao_modal.tsx](../../app/admin/settings/api-server/nova_integracao_modal.tsx), [app_integracao_modal.tsx](../../app/admin/settings/api-server/app_integracao_modal.tsx)

## O que é

Tela com 2 abas: **Servidores** (painéis de revenda IPTV: NaTV, Fast, Elite) e **Aplicativos** (players de terceiros: GerenciaApp, DupleCast, IBO Sol, IBO Pro, Quick Player, MessiTV, BOB Player, IBO Player, IPTV Duplex Play, IPTV Playerio, Duplex TV, ClouDDy, Ninja Player). É aqui que a "integração automática" citada em [gerenciador-aplicativo.md](gerenciador-aplicativo.md) e em [clientes.md](clientes.md) é de fato configurada.

## De onde vêm os dados

- **`vw_server_integrations`** — leitura para a lista de servidores (não inclui token/secret).
- **`server_integrations`** — CRUD real (token, secret, base URL em texto puro).
- **`app_integrations`** — CRUD real (login, senha, PIN em texto puro).
- **`servers`**, **`apps`** — leitura, para herdar logo/ícone.
- Storage: Cloudflare R2 (ícone de integração), Supabase Storage bucket `extensions` (arquivo `unigestor-extensao.zip`, a extensão Chrome usada nos fluxos Elite/IBO Sol/ClouDDy).

## Rotas de API chamadas

- `POST /api/integrations/elite/sync` — `get_credentials` / `save_sync`.
- `POST /api/integrations/natv/sync` — valida token em `revenda.pixbot.link`.
- `POST /api/integrations/fast/sync` — `api.painelcliente.com/profile/{token}`, timeout de 15s.
- `POST /api/upload/presign` — ícone de app.

## Integrações externas suportadas

**Servidores**: NaTV, Fast, Elite. **Aplicativos**: os 12 listados acima.

## Modais

`NovaIntegracaoModal` (servidor), `AppIntegracaoModal` (app, com upload da extensão Chrome).

## Correção aplicada

1. **[CORRIGIDO — segurança] `get_credentials` do sync Elite não validava se a integração pertencia ao tenant do usuário autenticado.** A rota usa Service Role (que ignora RLS) e buscava a integração só por `id`, sem checar `tenant_id`. Um usuário autenticado de outro tenant que soubesse/adivinhasse o UUID de uma integração alheia conseguiria, em tese, receber a senha real do painel Elite de outro tenant. Corrigido: para requisições vindas do navegador (não internas/cron), a rota agora resolve o `tenant_id` do usuário autenticado e recusa (`"Integração não encontrada"`) se a integração pertencer a outro tenant.

## Comportamento confirmado intencional (não é bug)

2. **Token/secret de servidor e senha de app ficam sempre em texto visível, sem mascarar.** Confirmado com o Márcio: é proposital — essas credenciais (painel NaTV/Fast/Elite, login do painel do app) precisam ser lidas/copiadas rapidamente para manutenção, e a própria tela já avisa isso no subtítulo do modal de edição ("token/secret ficam visíveis para facilitar manutenção"). Cheguei a mascarar esses campos numa passada anterior, mas revertido — não mexer aqui de novo sem pedido explícito.
3. **Sync do Elite sem timeout** (botão "Sincronizar" pode ficar preso em "Sincronizando..." se a extensão não responder) — mesma decisão de [clientes.md](clientes.md): o fluxo depende do tempo real da extensão no navegador, um timeout fixo arriscaria cortar uma operação legítima. Não alterado.

## Achados que ficam para confirmação/investigação (não alterados)

4. **Sem RLS versionada no repo para `server_integrations`/`app_integrations`/`vw_server_integrations`** — diferente de `coupons`/`coupon_redemptions`, que têm RLS documentada em `docs/sql/coupons.sql`. Não dá para confirmar pelo código se os `DELETE`s desta tela (sem `.eq("tenant_id", ...)` explícito) são de fato barrados por RLS para outros tenants. Recomendo verificar direto no Supabase e, se confirmado, versionar a definição.
5. Credenciais do Elite (baseUrl/username/password) trafegam via `window.CustomEvent` para a extensão — arquitetura já em uso, não uma regressão nova, mas registrando que qualquer outra extensão instalada com permissão de escutar eventos DOM da página poderia em tese capturá-las.

## Sugestão de melhoria

- Adicionar `.eq("tenant_id", tenantId)` explícito nos deletes desta tela como defesa em profundidade, mesmo que a RLS já proteja.

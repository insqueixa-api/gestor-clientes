# Tela: Gerenciador de Mensagem (`/admin/gerenciador/mensagem`)

Arquivo: [app/admin/gerenciador/mensagem/page.tsx](../../app/admin/gerenciador/mensagem/page.tsx)

## O que é

CRUD de templates de mensagem do WhatsApp, com placeholders (`{tag}`), preview, upload de imagem e um sistema de "variações" por template — sorteadas nos envios automáticos para evitar o padrão repetitivo que o WhatsApp associa a disparo em massa. Também tem geração de variação por IA (Gemini).

## De onde vêm os dados

- **`message_templates`** — `id, name, content, updated_at, is_system_default, image_url, category`.
- **`message_template_variants`** — CRUD direto client-side (`id, template_id, content, tenant_id`).
- Storage bucket `chat_media` (`${tenant_id}/templates/...`) — imagens de template.

## Rotas de API chamadas

- `POST /api/whatsapp/generate-variant` — gera uma variação de texto com Gemini (`gemini-flash-latest`), preservando todas as `{variáveis}` do texto original (retry 1x se a IA "perder" alguma variável). Não toca banco — quem persiste é o front.

## Integrações externas

Gemini (`lib/whatsapp/gemini-client.ts`), Supabase Storage.

## Modais

`PreviewModal` e `EditorModal`, ambos definidos no próprio arquivo.

## Achados (não alterados)

1. **Trigger de `message_templates` que travava edição — corrigida no banco em 25/07/2026, mas sem SQL versionado no repo.** A memória do projeto registra que `trigger_enforce_message_defaults` referenciava uma coluna inexistente (`OLD.master_only`), quebrando qualquer UPDATE/DELETE em `message_templates`. A correção foi feita direto no Supabase, sem arquivo `.sql` correspondente em `docs/sql/` — **não dá para confirmar pelo código-fonte que o fix está ativo em produção hoje**. Recomendo verificar direto no Supabase e, se confirmado, versionar a definição da função/trigger em `docs/sql/` para não depender só de memória de conversa.
2. `PROTECTED_TEMPLATES` (lista de nomes hardcoded no front) duplica a proteção que já existe via `is_system_default` no banco — funciona hoje (a checagem usa `||`, então continua bloqueando certo mesmo com a lista desatualizada), mas é frágil a um rename futuro de template no banco.

## Sugestão de melhoria

- Versionar a definição SQL da trigger/função `enforce_message_template_system_defaults` em `docs/sql/`.

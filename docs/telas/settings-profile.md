# Tela: Settings › Profile (`/admin/settings/profile`)

Arquivo: [app/admin/settings/profile/page.tsx](../../app/admin/settings/profile/page.tsx)

## O que é

Perfil do admin — mais carregada do que o nome sugere. Além de dados cadastrais (nome, telefone com detecção de DDI, WhatsApp username validado ao vivo na VM), tem um módulo de acompanhamento de saúde pessoal (peso/IMC com gráfico histórico) e um hub de import/export de planilhas Excel para 7 entidades do sistema (aplicativo, servidor, financeiro, cobrança, revenda, mensagem, cliente). Não há foto de perfil nem 2FA.

## De onde vêm os dados

- **`profiles`** — nome, telefone, whatsapp_username, birth_date, gender, height, `health_history` (array JSON na própria coluna).
- **`tenant_members`** join `tenants` — resolve o tenant do usuário logado.
- Supabase Auth (`auth.getUser()`, `auth.resetPasswordForEmail()`).

## Rotas de API chamadas

- `POST /api/whatsapp/validate` — valida o `whatsapp_username`, com fallback sessão 1→2.
- `GET/POST /api/import_export/{aplicativo,servidor,financeiro,cobranca,revenda,mensagem,cliente}/{export,template,import}` — 21 rotas possíveis (7 entidades × 3 ações), todas com Bearer token da sessão. O hub central de import/export do sistema, hospedado aqui em vez de numa tela própria.

## Integrações externas

WhatsApp (indireta, via `/api/whatsapp/validate`).

## Achados (não alterados)

1. **"Alterar Senha" é só um link de recuperação por e-mail, não uma troca direta** (`auth.resetPasswordForEmail`). Comportamento correto de segurança, mas o rótulo pode confundir quem espera digitar a senha atual + nova senha na própria tela.
2. **Sem 2FA** — confirmado, nenhum campo/toggle/rota relacionado.
3. **Sem upload de foto do admin** — os commits recentes de "foto cliente id" são sobre foto de cliente, não do admin.
4. **`catch {}` silencioso em quase todo handler de import/export** — se uma rota de import falhar, o usuário só vê o spinner sumir sem nenhum aviso de que nada foi importado. Não corrigi porque são 7 handlers praticamente idênticos e prefiro revisar/testar com calma antes de mexer numa área que já mexe com dados de todas as entidades do sistema, em vez de aplicar um fix mecânico rápido demais aqui.

## Sugestões de melhoria

- Adicionar toast de erro nos `catch {}` das 7 funções de import.
- Considerar mover o hub de import/export para uma tela própria de "Dados/Backup", já que cresceu para 7 entidades × 3 ações dentro de uma tela de perfil pessoal.

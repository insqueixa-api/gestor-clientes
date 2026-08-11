# Tela: Agenda (`/admin/agenda`)

Arquivo: [app/admin/agenda/page.tsx](../../app/admin/agenda/page.tsx)

## O que é

Apesar do nome, não é uma agenda de compromissos/calendário — é a **agenda telefônica** do WhatsApp Business, espelhando os contatos da conta Google vinculada ao tenant. É 100% Client Component (`"use client"`): toda leitura acontece no navegador via `supabaseBrowser`, sem Server Component por trás.

Permite criar/editar/excluir contato, enviar mensagem avulsa de WhatsApp, validar se um número tem WhatsApp ativo, sincronizar foto de perfil do WhatsApp para o Google Contacts, consultar operadora (Telein) e atribuir grupos/labels em massa.

## De onde vêm os dados

- **Tabela `google_contacts`** — única fonte de leitura: `select("*").eq("tenant_id", tid)`, sem paginação no servidor (traz tudo de uma vez; a paginação de 30/50/100/200/500 é só sobre o array já carregado no browser). Se a base de contatos crescer muito, isso pode ficar pesado — hoje não é um problema real, mas é o primeiro lugar a otimizar se a agenda começar a demorar para carregar.
- Nenhuma view ou RPC é usada.

## Rotas de API chamadas

| Rota | Uso |
|---|---|
| `/api/whatsapp/validate` | Verifica se um número tem WhatsApp ativo |
| `/api/whatsapp/status` | Status da sessão de WhatsApp |
| `/api/whatsapp/envio_avulso` | Envia mensagem avulsa pelo modal "Enviar Mensagem Rápida" |
| `/api/whatsapp/contact-photo` | Sincroniza foto do WhatsApp → sobe pro Google Contact |
| `/api/auth/google/sync-silent?mode=replace` | Botão "Importar Google" — **substitui** todos os contatos locais pelo que vier do Google |
| `/api/auth/google/create` | Criar contato novo |
| `/api/auth/google/update` | Editar contato existente |
| `/api/auth/google/delete` | Excluir contato (local + opcionalmente do Google) |
| `/api/auth/google/push-to-google` | "Reenviar Google" em massa |
| `/api/auth/google/sync-operadora` | "Operadora" em massa — consulta Telein + grava no Google |
| `/api/auth/google/sync-labels-from-clients` | "Servidor" em massa — vincula grupo = nome do servidor batendo telefone com `clients` |
| `/api/auth/google/bulk-add-label` | "Grupo" em massa — atribui um label a vários contatos |
| `/api/auth/google/lookup-operadora` | Consulta operadora/país ao confirmar telefone no modal |
| `/api/auth/google` (GET) | Redirect OAuth quando a sessão do Google expirou |

## Integrações externas

- **Google People API** (OAuth) — leitura/escrita de contatos, grupos e fotos. Token do tenant em `tenants.google_refresh_token`.
- **WhatsApp** (VM própria) — validação de número, envio avulso, foto de perfil.
- **Telein** (`lib/telein.ts`) — consulta de operadora por número BR.

## Modais

- **Enviar Mensagem Rápida** — WhatsApp avulso pro contato.
- **Criar/Editar Contato** — nome, telefones (com DDI, confirmação, status WhatsApp, sync de foto/operadora), e-mails, foto, grupos.
- **Excluir Contato** — com checkbox "Excluir também do Google Contacts" (padrão ligado).

## Achados e correções aplicadas

1. **[CORRIGIDO] Perda de dados na importação do Google, contas com mais de 1000 contatos.** `app/api/auth/google/sync-silent/route.ts` buscava só a primeira página de contatos do Google (`pageSize=1000`, sem `pageToken`). O botão "Importar Google" desta tela primeiro **apaga todos os contatos locais do tenant** e depois insere só o que veio dessa página única — então, para contas com mais de 1000 contatos, tudo além dos primeiros 1000 era **permanentemente perdido** no banco local (o Google em si não era afetado). Corrigido adicionando o loop de paginação (`pageToken`) que já existia em outra rota do mesmo módulo (`create/route.ts`).
2. **[CORRIGIDO] Exclusão "silenciosa" quando o Google recusa apagar o contato.** `app/api/auth/google/delete/route.ts` não verificava se a chamada `DELETE` para o Google teve sucesso — se falhasse (token expirado, rate limit), a rota seguia e apagava a linha local mesmo assim, mostrando "Contato removido do sistema e do Google" mesmo quando só saiu do sistema. Agora a rota devolve `googleDeleteFailed` e a tela mostra um toast diferente ("Removido só do sistema") quando isso acontece, para o admin saber que o contato pode continuar no celular.

## Observações não alteradas (sugestões de melhoria)

- A 2ª sessão de WhatsApp (`session2`) já é aceita pelo backend de envio avulso, mas o dropdown do modal nunca oferece essa opção — só existe a sessão "default".
- Duas das quatro ações em massa (Servidor/grupo por cliente e Atribuir grupo) não limpam a seleção de contatos ao final, diferente das outras duas — inconsistência de UX, não afeta dados.

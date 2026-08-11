# Tela: Revendedor (`/admin/revendedor` e `/admin/revendedor/[id]`)

Arquivos: [app/admin/revendedor/page.tsx](../../app/admin/revendedor/page.tsx), [[id]/page.tsx](../../app/admin/revendedor/%5Bid%5D/page.tsx), `novo_revenda.tsx`, `recarga_revenda.tsx`, `vincular_servidor.tsx`

## O que é

"Revendedor" (ou "revenda") é uma entidade **totalmente separada de cliente** — tabela própria `resellers`, não compartilha linha com `clients`. É alguém que compra créditos de um ou mais servidores da conta para revender por conta própria. O sistema rastreia contato/WhatsApp, quais servidores ele tem acesso (com usuário/senha próprios no painel), histórico de vendas de créditos, e envio de mensagem de cobrança/comprovante.

- **Lista**: faturamento/custo/lucro calculados no browser, filtros, envio de mensagem agora/agendada, recarga rápida, editar, arquivar/restaurar, excluir definitivo.
- **Ficha**: resumo (total investido), contatos/observações, servidores vinculados (recarga/editar/remover vínculo), histórico de compras (com exclusão de registro).

## De onde vêm os dados

| Objeto | Uso |
|---|---|
| `vw_resellers_list_active` / `vw_resellers_list_archived` | Lista principal |
| `vw_resellers_list` (sem sufixo) | Ficha do revendedor — não encontrei a definição SQL versionada no repo |
| `vw_reseller_servers` | Vínculos servidor↔revenda na ficha e no modal de recarga |
| `resellers` | Update de limpeza de campos |
| `reseller_servers` | Vínculo revenda↔servidor |
| `server_credit_sales` | Histórico de compras |
| `servers` | Nome + `avg_credit_cost_brl` (custo interno) para cálculo de custo/lucro |
| `server_integrations` | Provider (FAST/NATV) para decidir rota de sync |
| `tenant_fx_rates` | Câmbio na recarga |
| `message_templates` / `message_template_variants` | Templates e variantes anti-detecção |
| `client_message_jobs` | Fila de mensagens agendadas (coluna `reseller_id`) |

**RPCs chamadas do browser**: `update_reseller`, `delete_reseller_forever`, `create_reseller_and_setup`, `set_reseller_phones`, `unlink_reseller_from_server`, `get_last_reseller_sale`, `sell_credits_to_reseller_without_balance`, `sell_credits_to_reseller_and_log`, `client_message_cancel`. Só as 3 primeiras da segunda metade têm `CREATE FUNCTION` versionado em `docs/sql/` (já corrigidas com guard de tenant); as outras 6 não têm SQL no repo — recomendo confirmar diretamente no Supabase se têm a mesma trava de tenant, já que criam/apagam revenda e vendem créditos.

## Rotas de API chamadas

- `POST /api/whatsapp/envio_agora` — envia mensagem agora (cliente ou revenda, via `reseller_id`).
- `POST /api/whatsapp/envio_programado` — agenda mensagem (ver correção 1 abaixo).
- `POST /api/whatsapp/validate` — valida número no form de novo revendedor.
- `GET /api/whatsapp/profile[2]` — status das 2 sessões.
- `POST /api/integrations/{fast,natv}/sync` — sincroniza saldo após venda com integração.

## Integrações externas

WhatsApp (VM própria), Fast/NaTV (mesmas integrações de [gerenciador-servidor.md](gerenciador-servidor.md)).

## Correções aplicadas

1. **[CORRIGIDO] Agendar mensagem para revendedor estava totalmente quebrado.** O botão "Programar" chamava `fetch("/api/whatsapp/envio_agendado", ...)` — rota que **não existe** no projeto (a rota real é `envio_programado`, usada corretamente nas telas de Clientes e Testes). Além disso, o campo `send_at` do corpo da requisição nunca era calculado de verdade: a variável `sendAtIso` era declarada como string vazia (`""`) e um bloco `try` logo abaixo calculava `sendAtRaw` só para descartá-lo, sem nunca usar o helper `localDateTimeToIso` já existente (e não utilizado) no mesmo arquivo. Ou seja: toda tentativa de agendar mensagem para um revendedor batia num 404 e, mesmo que a rota existisse, mandaria uma data vazia. Corrigido: troquei a URL pela rota certa e liguei `sendAtIso = localDateTimeToIso(local)` no lugar do valor vazio — confirmei que o formato do corpo (`tenant_id, reseller_id, message, send_at, whatsapp_session, message_template_id`) já bate exatamente com o que `envio_programado/route.ts` espera (o tipo `ScheduleBody` da rota já suporta `reseller_id` nativamente).
2. **[CORRIGIDO] Envio de mensagem para revenda não tinha fallback de telefone.** `fetchResellerWhatsApp` resolvia o destino só por `whatsapp_username`, sem cair para `whatsapp_e164`/`phone_e164` como o equivalente de clientes (`fetchClientWhatsApp`) já fazia. Como o campo `whatsapp_username` só é preenchido automaticamente se o operador clicar no botão de confirmar telefone no formulário, uma revenda com telefone certo cadastrado mas sem essa confirmação nunca recebia mensagem nenhuma — mesmo o comprovante de recarga. Adicionado o mesmo fallback de 3 níveis usado para clientes.
3. **[CORRIGIDO] Pílulas de servidor na lista mostravam servidor arquivado como se estivesse ativo.** A query de servidores usada para montar as pílulas "Servidores" por revenda não filtrava `is_archived`, diferente do modal de recarga rápida (que já filtrava). Um servidor arquivado continuava aparecendo como vinculado na lista, mesmo não sendo mais oferecido como opção de recarga. Adicionado o mesmo filtro.

## Achados que ficam para confirmação (não alterados)

4. **Campo "Preço personalizado" (`unit_price_override`) é usado no código mas não existe no formulário.** `vincular_servidor.tsx` declara e usa o estado `priceOverride`, mas não há nenhum campo de input correspondente no JSX renderizado — só "Servidor", "Usuário no Painel" e "Senha". Na prática esse valor nunca é definido pela UI hoje. Preciso confirmar se foi removido de propósito (substituído pela sugestão de preço via histórico) ou esquecido, antes de reintroduzir o campo.
5. **`vw_resellers_list` (usada na ficha do revendedor) não tem definição SQL versionada no repositório** — plausivelmente é uma view "base" sem filtro de arquivado, mas não há como confirmar pelo código. Recomendo validar direto no Supabase antes de qualquer alteração na ficha do revendedor.

## Sugestões de melhoria (não-críticas, não alteradas)

- Cálculo de custo/lucro da lista é feito 100% no browser, buscando tabelas inteiras do tenant a cada carregamento — escalaria melhor como view/RPC agregada.
- Coluna `payment_method` de `server_credit_sales` é lida mas nunca preenchida nem exibida — campo morto.
- `formatPhoneDisplay`/`formatPhoneE164BR` estão duplicadas entre `page.tsx` e `[id]/page.tsx` com lógicas levemente diferentes.

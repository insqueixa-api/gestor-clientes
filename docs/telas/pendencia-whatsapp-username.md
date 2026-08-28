# Pendência: envio/validação de WhatsApp por username

Checklist de referência rápida para quando o Baileys (ou o que vier a substituí-lo) passar a suportar operações por username. Complementa [Identidade híbrida no WhatsApp](portal-identidade-hibrida.md), que documenta a arquitetura completa já pronta.

## Status: preparação concluída, só falta suporte externo

Todo o lado do **seu sistema** está pronto para aceitar `whatsapp_username` como telefone OU username, do cadastro ao pagamento. Testado ao vivo em 12/08/2026, inclusive um cenário adversarial (conta real sem telefone nenhum, só username aleatório com caractere especial) — achou e corrigiu um bug de normalização no processo. O que falta **não é código seu** — é o WhatsApp (via Meta ou via bibliotecas não-oficiais como o Baileys) abrir uma porta para buscar/validar/enviar mensagem usando só o username, sem telefone.

## O que já está pronto (não precisa mexer de novo)

- Cadastro de cliente aceita conta sem telefone, só com username (`app/admin/cliente/novo_cliente.tsx`).
- `whatsapp_username` funciona como identidade de login/portal mesmo sem telefone associado (âncora de telefone é opcional, cai em `NULL` graciosamente).
- Envio de mensagem sempre tenta achar um telefone real primeiro (`whatsapp_username` → `whatsapp_e164` → `phone_e164`, cada um normalizado antes de cair pro próximo — `lib/whatsapp/template-vars.ts::firstNormalizedPhone`). Se não achar telefone nenhum, a mensagem simplesmente não sai (sem erro escondido — é esperado até a próxima etapa existir).
- LID (identificador que o WhatsApp já usa desde 2024) é mapeado tanto no recebimento quanto na validação de número, na VM (`whatsapp-service/src/sessionManager.js`).
- Login/token do Portal, listagem de contas, pagamento (renovação/pendência/app) e cupom — tudo funciona com identidade híbrida, testado ao vivo com conta real sem telefone.

## O que falta — e exatamente onde mexer quando existir

### 1. Validar se um username existe no WhatsApp

Hoje `/api/whatsapp/validate` (`app/api/whatsapp/validate/route.ts`) só aceita `{ phone }` e chama `validateNumber(sessionKey, phone)` em `whatsapp-service/src/sessionManager.js`, que monta um JID por telefone (`normalizeJid`) e usa `sock.onWhatsApp(jid)`.

Quando existir um método equivalente pra username (`sock.onWhatsAppByUsername(username)` ou parecido, nome hipotético):
- `whatsapp-service/src/sessionManager.js` — adicionar uma função irmã de `validateNumber` (ex: `validateUsername`), ou fazer `validateNumber` detectar se o valor recebido é telefone ou username e rotear internamente.
- `app/api/whatsapp/validate/route.ts` — aceitar `{ phone }` OU `{ username }` no body.
- `app/admin/cliente/novo_cliente.tsx` (`validateWa`, linha ~727) — hoje pula a validação de propósito quando o valor não tem 8+ dígitos (com um comentário explicando por quê). Trocar o `return` antecipado por uma chamada real de validação por username.

### 2. Enviar mensagem usando só o username (sem telefone)

Hoje `sendMessage(sessionKey, phone, ...)` em `sessionManager.js` sempre monta o JID a partir de dígitos de telefone (`normalizeJid`).

Quando existir um jeito de mandar mensagem só com o username:
- `whatsapp-service/src/sessionManager.js` — `sendMessage` precisa aceitar um identificador que não seja telefone (ou uma variante nova da função).
- `lib/whatsapp/template-vars.ts::firstNormalizedPhone` — hoje só extrai dígitos. Precisaria de uma lógica nova tipo "se não achou telefone em nenhum campo, mas `whatsapp_username` parece um username válido, manda o username puro pra VM" — mudando o contrato de `phones[]` em `fetchClientWhatsApp`/`fetchResellerWhatsApp` pra incluir um `type: "phone" | "username"`.
- Todas as rotas de envio (`app/api/whatsapp/envio_agora`, `envio_programado`, `envio_simulado`, `envio_avulso`) — hoje mandam `{ phone: <dígitos> }` pra VM. Precisariam mandar `{ phone }` ou `{ username }` dependendo do tipo resolvido.

### 3. Buscar o username de alguém a partir do telefone (ou vice-versa)

Não existe, e pelas fontes consultadas (ver [portal-identidade-hibrida.md](portal-identidade-hibrida.md) e o histórico desta conversa), **provavelmente nunca vai existir pra terceiros** — a Meta decidiu deliberadamente não ter diretório público nem autocomplete, nem no app oficial. Diferente dos itens 1 e 2, isso não é "ainda não implementado", é uma escolha de privacidade. Não vale a pena planejar código em cima disso.

## Como saber quando isso mudou

- Acompanhar o repositório do Baileys: `@whiskeysockets/baileys` (versão hoje: `^6.17.16`, em `whatsapp-service/package.json`). A issue que perguntou exatamente isso aos mantenedores: [github.com/WhiskeySockets/Baileys/issues/2516](https://github.com/WhiskeySockets/Baileys/issues/2516) — **fechada como "stale" em ago/2026, sem nenhuma resposta de mantenedor**.
- `docs.wa.me`/blog oficial do WhatsApp Business — rollout de usernames é real e em andamento: reserva de username liberada globalmente a partir de jun/2026, uso de fato (mandar/receber sem expor telefone) em rollout gradual desde abr/2026, "ao longo dos próximos meses" — ainda não é 100% dos usuários (checado 27/08/2026).
- **ATUALIZAÇÃO 27/08/2026** — achado: a partir da `v7.0.0-rc10` (6/mai/2026) o changelog do Baileys lista **"Username and Usync support"** ([release](https://github.com/WhiskeySockets/Baileys/releases/tag/v7.0.0-rc10)). Só que:
  - Só existe na linha **7.0.0** (ainda RC — `rc14` em 29/jul/2026, sem stable publicada). A versão instalada aqui (`6.17.16`) é a última **estável**, e não tem esse suporte.
  - **Sem documentação oficial** — a página de referência (`WhatsApp IDs`, mintlify) não menciona username em lugar nenhum ainda. É só uma linha no changelog, sem exemplo de uso, sem saber exatamente o que a função faz/expõe.
  - Ver [[project_dependency_updates_pattern]] — decisão de não instalar RC em produção continua valendo aqui também; a barreira agora não é "não existe no Baileys", é "só existe em pré-lançamento não documentado".
- Teste rápido pra saber se mudou de vez (stable): chamar `sock.onWhatsApp("algumusername")` (sem ser um número) na VM e ver se volta algo diferente de "não existe" — hoje simplesmente falha/retorna vazio.

## Se um dia isso for possível só via API oficial paga (Business Cloud API), não via Baileys

Nesse caso a VM inteira (`whatsapp-service/`) deixaria de ser o caminho — seria uma migração bem maior (nova integração com a API oficial da Meta, custos de mensagem, `phone_number_id`, webhooks do Graph API), não um ajuste pontual nos arquivos acima. Vale reavaliar o custo-benefício nessa hora, não assumir que é só "mais uma função".

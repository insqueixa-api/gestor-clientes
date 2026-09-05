# Emissão de nota fiscal no Portal do Cliente — Reforma Tributária

Iniciado 04/09/2026. Prazo desejado pelo Márcio: deixar pronto ainda em setembro/2026.
Não é uma regra exclusiva do Rio de Janeiro — é a Reforma Tributária nacional (IBS/CBS),
confirmado via pesquisa (ver Fontes no fim do arquivo).

## Por que agora

A partir de **1º de janeiro de 2027**, MEI passa a ser obrigado a emitir nota fiscal em
**toda venda**, inclusive pra pessoa física — hoje só é obrigatório vendendo pra outra
empresa (pessoa jurídica). Como o negócio vende majoritariamente pra pessoa física via
WhatsApp/portal, isso passa a exigir emissão em praticamente toda renovação.

Cronograma nacional (Reforma Tributária, IBS/CBS) confirmado:
- **3/ago/2026** — NF-e/NFC-e com campos de IBS/CBS já obrigatório (já em vigor).
- **1/out/2026** — NFS-e obrigatória pra serviços sujeitos a ISS (lista anexa à LC 116/2003).
- **1/dez/2026** — obrigatoriedade alcança serviços prestados/intermediados por plataforma digital.
- **1/jan/2027** — obrigatoriedade de informar IBS/CBS se estende a optantes do Simples
  Nacional; e passa a valer a obrigatoriedade de nota em toda venda do MEI (inclusive PF).

Desde **1/jan/2026** a Prefeitura do Rio de Janeiro descontinuou o sistema próprio (Nota
Carioca) — a emissão de NFS-e no município do RJ passa a ser 100% pelo **Emissor Nacional
de NFS-e** (sistema único nacional, não mais por prefeitura). Isso simplifica a integração:
não é uma API por município, é um padrão nacional.

## O que o Márcio pediu (verbatim, resumido)

1. No fluxo de pagamento do Portal do Cliente (renovação de assinatura), o cliente poderá
   optar por informar CPF ou CNPJ pra emissão de nota fiscal — opcional, não obrigatório
   pro cliente final (a obrigação de EMITIR é do Márcio, não do cliente de fornecer o dado,
   mas sem o CPF/CNPJ não tem nota).
2. Se o cliente informar, o sistema registra o dado e dispara a emissão da nota via
   integração externa (Márcio disse "chamada para a Receita Federal" — a emissão real de
   NFS-e não é direto na Receita Federal, é no Emissor Nacional de NFS-e/prefeitura, ou via
   um provedor terceirizado — ver seção Tecnologia abaixo. Vale alinhar esse ponto com o
   contador antes de fechar a integração).
3. Guardar o comprovante/nota por **5 anos** no R2, vinculado ao registro de pagamento
   (o pagamento já existe hoje — a nota fica "do lado" desse registro).
4. **Mudança de retenção de dados**: hoje o cliente é apagado após 60 dias de inatividade
   (ver `auto_purge_expired_clients_daily` em `lib/cron-health.ts`). Isso não pode mais
   acontecer se existir nota fiscal vinculada — precisa reter o registro (cliente e/ou só
   o comprovante fiscal) pelos 5 anos, mesmo que o cliente em si seja arquivado/inativo.
5. Possíveis deduções na base de cálculo (não declarar o valor bruto de venda) — Márcio
   mencionou isso de passagem, sem detalhar. **Isso é decisão de contador, não técnica** —
   documentar aqui só como lembrete de perguntar, não assumir nenhuma regra de cálculo
   sem confirmação de um contador.

## Perguntas em aberto (resolver nas próximas conversas, antes de implementar)

- [ ] O negócio hoje é MEI ou Simples Nacional (não-MEI)? Muda limite de faturamento,
      regras de dedução e o próprio texto da obrigatoriedade.
- [ ] O serviço vendido (acesso IPTV/streaming) se enquadra em qual item da lista anexa à
      LC 116/2003 (ISS)? Precisa confirmar com o contador o código de serviço correto —
      isso afeta a nota (NFS-e) e a alíquota de ISS aplicável.
- [ ] Qual provedor de API usar pra emissão (Focus NFe, NFE.io, eNotas, ou outro) —
      comparar custo por nota emitida x volume mensal de renovações do Márcio antes de
      decidir. eNotas tem fluxo pronto pra "emite automático ao confirmar pagamento",
      pode encaixar bem no fluxo do Portal.
- [ ] Confirmar com o contador: é NFS-e (serviço, prefeitura/emissor nacional) ou existe
      algum cenário de NF-e (produto)? A princípio é serviço (acesso/licença), então NFS-e.
- [ ] Regra de retenção: apagar só o CLIENTE (perfil/dados de contato) mas manter o
      registro de PAGAMENTO+NOTA por 5 anos? Ou manter o cliente inteiro? Definir o menor
      dado possível a reter (efeito colateral: LGPD — reter só o necessário pra
      comprovação fiscal, não o cadastro inteiro, se der pra separar).
- [ ] CPF/CNPJ do cliente — onde fica armazenado (tabela `clients` ganha campo, ou tabela
      nova `client_portal_invoices`/similar ligada ao pagamento)? Criptografado em repouso?
- [ ] Fluxo de erro: se a emissão falhar (fora do ar, CPF inválido etc.) o pagamento já foi
      confirmado — precisa de um mecanismo de retry/reprocessamento (mesmo espírito do
      botão "Reprocessar agora" que já existe na tela Sistema).

## Esboço técnico (não implementar ainda — só orientação pra quando começar)

- Portal do Cliente: checkbox opcional "Quero nota fiscal" no checkout → campo CPF/CNPJ
  condicional (com validação de dígito verificador).
- Nova tabela (nome a definir) ligada 1:1 ou 1:N a `client_portal_payments`, guardando:
  CPF/CNPJ informado, status da emissão (pendente/emitida/erro), XML/PDF da nota (ou
  referência do arquivo no R2), chave de acesso da nota, data de emissão.
- Upload do PDF/XML da nota pro R2 (mesmo padrão de storage já usado no projeto —
  `R2_BUCKET_NAME`/`R2_VAULT_BUCKET_NAME`), com retenção mínima de 5 anos (sem purge
  automático antes disso).
- Ajustar `auto_purge_expired_clients_daily` (`lib/cron-health.ts` +
  função SQL correspondente) pra NUNCA apagar um cliente com nota fiscal emitida nos
  últimos 5 anos — ou separar "apagar dados de contato" de "manter registro fiscal",
  dependendo da resposta da pergunta em aberto acima.
- Job de emissão assíncrona (não travar o checkout esperando a Receita/prefeitura
  responder) — dispara depois do pagamento confirmado, com retry em caso de falha.

## Fontes (pesquisa de 04/09/2026)

- [Reforma Tributária MEI: O que muda em 2027 nas regras?](https://www.contabeis.com.br/artigos/78949/reforma-tributaria-mei-o-que-muda-em-2027-nas-regras/)
- [MEI será obrigado a emitir nota fiscal em 2027? Entenda o que muda e como se preparar](https://winsitegestao.com.br/blogs/central-do-mei-microempreendedor-individual/mei-sera-obrigado-a-emitir-nota-fiscal-em-2027-entenda-o-que-muda-e-como-se-preparar)
- [RFB divulga cronograma dos documentos fiscais do IBS e CBS](https://www.felsberg.com.br/cronograma-documentos-fiscais-ibs-cbs-2026)
- [IBS e CBS nos Documentos Fiscais: 4 Ondas](https://simplifique.contmatic.com.br/blogs/obrigatoriedade-ibs-cbs-documentos-fiscais-4-ondas-2026)
- [Emitir Nota Fiscal Carioca – Portal Carioca Digital](https://carioca.rio/objetivo/emitir-nota-fiscal-carioca/)
- [NFS-e Rio de Janeiro: Como Emitir no Emissor Nacional](https://simplifique.contmatic.com.br/blogs/nfse-rio-de-janeiro-emissor-nacional-iss)
- [Comparativo de APIs para Emissão de NFSe Nacional em 2026](https://www.notaas.com.br/blog/post/api-nfse-nacional-melhor-provedor-emissao-nota-fiscal-de-servico-eletronica-nacional)
- [NFE.io ou eNotas: qual é o melhor emissor de nota fiscal?](https://nfe.io/blog/nota-fiscal/nfeio-ou-enotas/)

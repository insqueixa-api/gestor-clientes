# Serviço de PDF (VM Google Cloud)

Gera o PDF do informativo de condomínio via Puppeteer — roda numa VM (não em função serverless da Vercel, que não é um bom lugar pra Chromium: binário grande, cold start, limite de tempo/memória). Mesmo padrão já usado no projeto pra VM do WhatsApp (`lib/whatsapp/wa-context.ts`): base URL + token fixo em `Authorization: Bearer`, request/response direto, sem fila/webhook.

**Esses arquivos aqui são só referência/documentação** — não são buildados por este projeto Next.js. O deploy de verdade é manual, direto na VM.

## Onde roda

- VM: `unigestor-whatsapp` (nome antigo, reaproveitada — rodava o WhatsApp antes, migrado pro Hetzner) — Google Cloud, zona `us-central1-f`, IP `34.69.145.29`, `e2-micro` (1GB RAM, 2 vCPU).
- SSH: `ssh -i ~/.ssh/gcp_key marcio@34.69.145.29`
- Container Docker `unigestor-pdf`, porta `3000`, `--restart=always` (sobrevive a reboot).
- Puppeteer só liga sob demanda (uma geração de PDF por request, poucos segundos) — não fica residente consumindo RAM o tempo todo. `e2-micro` em `us-central1` é elegível ao Always Free tier da GCP; se der OOM na prática, redimensionar pra `e2-small` (~US$6-7/mês) é rápido via console GCP (parar VM → trocar tipo → religar).

## Contrato da API

`POST /gerar-pdf`, header `Authorization: Bearer <PDF_VM_TOKEN>`, body JSON:
```json
{
  "condominio": { "nome", "logo_url", "endereco", "contato", "gestao", "slogan1", "slogan2", "cor_primaria", "cor_secundaria" },
  "edicao": { "tipo": "semanal|mensal", "data_referencia", "versao", "introducao" },
  "itens": [ { "titulo", "categoria", "texto", "status", "fotos": [{ "url", "legenda" }] } ]
}
```
Resposta: `application/pdf` (bytes direto). Fotos já são URLs do R2 — o Chromium carrega direto da internet, não precisa de upload nem arquivo local na VM.

Chamado pelo Next.js via `app/api/admin/condominio/gerar-pdf/route.ts` (env vars `PDF_VM_BASE_URL` + `PDF_VM_TOKEN` na Vercel).

## Como fazer deploy de uma atualização

```bash
# 1. Editar server.js/template.js aqui no repo, depois copiar pra VM:
scp -i ~/.ssh/gcp_key docs/vm-pdf-service/*.js docs/vm-pdf-service/Dockerfile docs/vm-pdf-service/package.json marcio@34.69.145.29:~/pdf-service/

# 2. Rebuildar e trocar o container:
ssh -i ~/.ssh/gcp_key marcio@34.69.145.29 "cd ~/pdf-service && sudo docker build -t unigestor-pdf-service . && sudo docker stop unigestor-pdf && sudo docker rm unigestor-pdf && sudo docker run -d --name unigestor-pdf --restart=always -p 3000:3000 -e PDF_VM_TOKEN='<mesmo token da Vercel>' unigestor-pdf-service"
```

## Achados/decisões

- Base image `ghcr.io/puppeteer/puppeteer` — já traz o Chromium com todas as dependências de sistema resolvidas (evita o clássico "faltou lib X" instalando na unha num Ubuntu mínimo).
- HTML montado com CSS puro embutido (sem Tailwind CDN) — nenhuma dependência de rede externa na hora de gerar, além das imagens do R2.
- Cores institucionais (cabeçalho/rodapé/título de seção) vêm de `condominio.cor_primaria`/`cor_secundaria`; a paleta de status de cada Ação (badge) é fixa — é um indicador semântico universal, não faz parte da identidade visual do condomínio.
- PDF de página única (altura = `scrollHeight` real do conteúdo), não multi-página com quebras — mesmo truque do protótipo local (Vidamerica).
- Porta 3000 reaproveitada do WhatsApp antigo — o firewall da GCP já estava liberado pra ela, testado e confirmado (`curl` externo funcionou sem precisar mexer em regra nenhuma).

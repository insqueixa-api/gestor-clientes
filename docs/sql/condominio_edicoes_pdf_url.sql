-- Guarda o PDF de uma Edição PUBLICADA no R2 (pedido do Márcio, 23/08/2026)
-- — pré-visualização continua descartável (não salva nada), só publicar
-- gera+sobe o PDF de verdade. Com isso, "Baixar PDF" de uma edição já
-- publicada usa o arquivo já pronto (não chama a VM/Puppeteer de novo a
-- cada download) — e serve de referência pra rotina de expurgo em
-- docs/sql/condominio_pdf_purge_cron.sql (deleta o arquivo do R2 6 meses
-- depois de published_at, mantendo a linha da edição só sem o PDF).

ALTER TABLE condominio_edicoes ADD COLUMN IF NOT EXISTS pdf_url text;

COMMENT ON COLUMN condominio_edicoes.pdf_url IS 'URL pública no R2 do PDF gerado ao publicar — null em rascunhos, e também depois que o expurgo de 6 meses remove o arquivo (a linha da edição continua existindo).';

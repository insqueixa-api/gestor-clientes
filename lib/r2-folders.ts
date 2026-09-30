// lib/r2-folders.ts
// Pastas do bucket público que o sistema grava e pode limpar (troca de
// arquivo em DELETE /api/upload e varredura de órfãos em
// /api/admin/r2/orphans). Pasta nova de upload tem que entrar aqui — e a
// coluna que guarda a URL, em public._r2_refs_blob() (docs/sql/r2_url_in_use.sql).
export const R2_DELETABLE_FOLDERS = new Set([
  "servers",
  "apps",
  "payment_gateways",
  "server_integrations",
  "api_integrations",
  "app_integrations",
  "condominios",
  "condominio-acoes",
  "condominio-pdfs",
  "geral",
]);

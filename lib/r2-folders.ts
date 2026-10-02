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
  "device_icons", // logo de aparelho (public.app_device_types, 02/10/2026)
]);

// ✅ 02/10/2026: todo arquivo público sobe com cache de 1 ano no navegador
// (nome único por upload = conteúdo nunca muda na mesma URL).
export const R2_PUBLIC_CACHE_CONTROL = "public, max-age=31536000, immutable";

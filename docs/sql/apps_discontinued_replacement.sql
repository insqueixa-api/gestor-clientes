-- Reaproveita a coluna apps.is_active (já existia, default true, mas nunca
-- era exposta/usada em lugar nenhum) como o flag "aplicativo descontinuado"
-- (is_active = false). Adiciona o nome do app recomendado no lugar, pra
-- mostrar no portal do cliente quando o app instalado for descontinuado
-- (ex: DuplexPlay -> recomendar DupleCast).
alter table public.apps
  add column if not exists discontinued_replacement_name text;

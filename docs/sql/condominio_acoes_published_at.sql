-- "Data de publicação" própria da Ação (achado 26/08/2026, pedido do
-- Márcio) — campo independente de entrar em alguma Edição/informativo
-- compilado (que já tem seu próprio published_at, condominio_edicoes).
-- Botão "Publicar"/"Despublicar" na tela de Ações (app/admin/settings/
-- condominio/page.tsx) só grava/limpa esse timestamp — nenhuma outra
-- lógica muda.
ALTER TABLE condominio_acoes
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Ícone próprio por integração, em Settings > API/Server (achado 26/08/2026,
-- pedido do Márcio): hoje só "Aplicativos" tem upload manual de ícone
-- (app_integrations.icon_url já existe). "Servidores" só mostra a logo
-- HERDADA de servers.logo_url (sem opção de trocar aqui) e "Parceiros"
-- (Appativa) não tem ícone nenhum. As 2 colunas abaixo dão a mesma
-- capacidade de upload manual pros outros 2 grupos — o que já aparece hoje
-- (herdado) continua aparecendo como fallback quando não houver upload
-- próprio aqui.

ALTER TABLE server_integrations ADD COLUMN IF NOT EXISTS icon_url text;
ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS icon_url text;

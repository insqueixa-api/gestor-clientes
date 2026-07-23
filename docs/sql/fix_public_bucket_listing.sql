-- Supabase Advisor: "Public Bucket Allows Listing" em chat_media e extensions.
--
-- Buckets marcados como `public: true` já servem arquivos por URL direta
-- (/storage/v1/object/public/<bucket>/<path>) sem precisar de NENHUMA policy
-- de RLS — esse caminho ignora storage.objects. As duas policies de SELECT
-- abaixo só serviam pra permitir *listar* (enumerar) todos os arquivos do
-- bucket, o que o app nunca usa (confirmado: só upload/getPublicUrl/remove
-- em ambos os buckets, nenhuma chamada a .list() em lugar nenhum).
--
-- Risco real: em chat_media a policy era pro role "public" (qualquer
-- visitante anônimo, sem login) — e como os caminhos são "<tenant_id>/
-- templates/<arquivo>", listar vazava quais tenants têm imagens de
-- mensagem e os nomes dos arquivos, sem necessidade nenhuma.
--
-- Removendo as duas: acesso a um arquivo já conhecido (via URL, como o app
-- sempre faz) continua funcionando normalmente; só a listagem/enumeração
-- deixa de ser possível.

DROP POLICY "Permitir leitura pública chat_media" ON storage.objects;
DROP POLICY "Permitir Upload 153tvkk_0" ON storage.objects;

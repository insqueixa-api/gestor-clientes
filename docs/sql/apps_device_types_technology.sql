-- docs/sql/apps_device_types_technology.sql
-- Adiciona categorização de dispositivo/tecnologia ao catálogo de apps —
-- base pra futura tela de "Manutenção" no portal do cliente (filtrar apps
-- por Samsung/LG, Android/TVBox, iOS, Computador, Fire TV, Roku, e cruzar
-- com client.technology pra não misturar app de IPTV com cliente P2P).
--
-- device_types: um app pode servir mais de um dispositivo (array).
-- technology: valor único (IPTV | P2P), espelha client.technology — hoje
-- 100% do catálogo é IPTV (nenhum app P2P foi cadastrado ainda).

ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS device_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS technology   text   NOT NULL DEFAULT 'IPTV';

COMMENT ON COLUMN apps.device_types IS
  'Dispositivos compatíveis: SAMSUNG_LG, ANDROID_TVBOX, IOS, COMPUTADOR, FIRE_TV, ROKU';
COMMENT ON COLUMN apps.technology IS
  'IPTV ou P2P — deve bater com clients.technology pra esse app aparecer pro cliente';

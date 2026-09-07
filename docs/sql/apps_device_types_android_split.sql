-- ✅ 06/09/2026, pedido do Márcio: "Android / TV Box" misturava celular e TV
-- Box num checkbox só (apps.device_types, text[] sem CHECK constraint) —
-- vira 2 tipos independentes daqui pra frente (lib/apps/device-types.ts).
-- ANDROID_PHONE é a MESMA chave antiga (ANDROID_TVBOX) só renomeada — dado
-- idêntico, nenhum app perde a marcação. ANDROID_TV é novo e nasce
-- herdando os mesmos apps que tinham o combinado antigo (estado inicial,
-- não é regra fixa — os 2 toggles ficam independentes a partir daqui).

UPDATE apps
SET device_types = array_replace(device_types, 'ANDROID_TVBOX', 'ANDROID_PHONE')
WHERE 'ANDROID_TVBOX' = ANY(device_types);

UPDATE apps
SET device_types = device_types || '{ANDROID_TV}'
WHERE 'ANDROID_PHONE' = ANY(device_types)
  AND NOT ('ANDROID_TV' = ANY(device_types));

COMMENT ON COLUMN apps.device_types IS
  'Dispositivos compatíveis: SAMSUNG_LG, ANDROID_PHONE, ANDROID_TV, XBOX, IOS, COMPUTADOR, FIRE_TV, ROKU';

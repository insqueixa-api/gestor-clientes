-- As views vw_clients_list_active/archived e vw_trials_list_active/archived
-- já traziam plan_table_id, price_currency e m3u_url, mas nunca traziam
-- name_prefix (a saudação principal do cliente, ex: "Dr.", "Dna.") — só
-- secondary_name_prefix estava lá. Por causa disso, as páginas de Clientes
-- e Teste faziam uma query extra em `clients` toda vez que abriam o modal
-- de editar, só pra buscar esse único campo.
--
-- CREATE OR REPLACE VIEW só permite ACRESCENTAR colunas no fim da lista
-- (não dá pra reordenar sem quebrar as colunas existentes), por isso
-- c.name_prefix aparece como último campo, mesmo não sendo o lugar mais
-- "lógico" de ler no SELECT. A ordem física não importa pro código, que
-- acessa por nome.
--
-- Aplicado em produção em 2026-07-18. Front-end (cliente/page.tsx e
-- teste/page.tsx) já foi atualizado pra ler name_prefix direto da linha da
-- view, sem chamada extra ao abrir o modal de editar.

CREATE OR REPLACE VIEW vw_clients_list_active AS
 SELECT c.id,
    c.tenant_id,
    c.display_name AS client_name,
    c.server_username AS username,
    c.server_password,
    c.vencimento,
        CASE
            WHEN c.is_archived THEN 'ARCHIVED'::text
            WHEN c.is_trial THEN 'TRIAL'::text
            WHEN c.vencimento < now() THEN 'OVERDUE'::text
            ELSE 'ACTIVE'::text
        END AS computed_status,
    c.is_archived AS client_is_archived,
    c.screens,
    c.plan_label AS plan_name,
    c.plan_table_id,
    pt.name AS plan_table_name,
    c.price_amount,
    c.price_currency,
    c.server_id,
    s.name AS server_name,
    c.technology,
    c.phone_e164 AS whatsapp_e164,
    c.whatsapp_username,
    c.whatsapp_opt_in,
    c.whatsapp_snooze_until AS dont_message_until,
    c.secondary_display_name,
    c.secondary_name_prefix,
    c.secondary_phone_e164,
    c.secondary_whatsapp_username,
    c.notes,
    c.m3u_url,
    c.created_at,
    c.updated_at,
    ( SELECT array_agg(a.name) AS array_agg
           FROM client_apps ca
             JOIN apps a ON a.id = ca.app_id
          WHERE ca.client_id = c.id) AS apps_names,
    ( SELECT count(*) AS count
           FROM client_alerts
          WHERE client_alerts.client_id = c.id AND client_alerts.status = 'OPEN'::text) AS alerts_open,
    ( SELECT jsonb_agg(jsonb_build_object('name', a2.name, 'integration_type', COALESCE(a2.integration_type, ''::text), 'expire_date', dv.expire_date)) AS jsonb_agg
           FROM client_apps ca2
             JOIN apps a2 ON a2.id = ca2.app_id
             LEFT JOIN LATERAL ( SELECT ca2.field_values ->> (fc_v.value ->> 'id'::text) AS expire_date
                   FROM jsonb_array_elements(a2.fields_config) fc_v(value)
                  WHERE (fc_v.value ->> 'type'::text) = 'date'::text AND (ca2.field_values ->> (fc_v.value ->> 'id'::text)) ~ '^\d{4}-\d{2}-\d{2}$'::text
                 LIMIT 1) dv ON true
          WHERE ca2.client_id = c.id) AS apps_data,
    c.name_prefix
   FROM clients c
     LEFT JOIN servers s ON c.server_id = s.id
     LEFT JOIN plan_tables pt ON c.plan_table_id = pt.id
  WHERE NOT c.is_archived;

CREATE OR REPLACE VIEW vw_clients_list_archived AS
 SELECT c.id,
    c.tenant_id,
    c.display_name AS client_name,
    c.server_username AS username,
    c.server_password,
    c.vencimento,
    'ARCHIVED'::text AS computed_status,
    c.is_archived AS client_is_archived,
    c.screens,
    c.plan_label AS plan_name,
    c.plan_table_id,
    pt.name AS plan_table_name,
    c.price_amount,
    c.price_currency,
    c.server_id,
    s.name AS server_name,
    c.technology,
    c.phone_e164 AS whatsapp_e164,
    c.whatsapp_username,
    c.whatsapp_opt_in,
    c.whatsapp_snooze_until AS dont_message_until,
    c.secondary_display_name,
    c.secondary_name_prefix,
    c.secondary_phone_e164,
    c.secondary_whatsapp_username,
    c.notes,
    c.m3u_url,
    c.created_at,
    c.updated_at,
    ( SELECT array_agg(a.name) AS array_agg
           FROM client_apps ca
             JOIN apps a ON a.id = ca.app_id
          WHERE ca.client_id = c.id) AS apps_names,
    ( SELECT count(al.id) AS count
           FROM client_alerts al
          WHERE al.client_id = c.id AND al.status = 'OPEN'::text) AS alerts_open,
    c.name_prefix
   FROM clients c
     LEFT JOIN servers s ON s.id = c.server_id
     LEFT JOIN plan_tables pt ON pt.id = c.plan_table_id
  WHERE c.is_archived = true AND (c.is_trial = false OR c.is_trial IS NULL);

CREATE OR REPLACE VIEW vw_trials_list_active AS
 SELECT c.id,
    c.tenant_id,
    c.display_name AS client_name,
    c.server_username AS username,
    c.server_password,
    c.vencimento,
    'TRIAL'::text AS computed_status,
    c.is_archived AS client_is_archived,
    c.screens,
    c.plan_label AS plan_name,
    c.plan_table_id,
    pt.name AS plan_table_name,
    c.price_amount,
    c.price_currency,
    c.server_id,
    s.name AS server_name,
    c.technology,
    c.phone_e164 AS whatsapp_e164,
    c.whatsapp_username,
    c.whatsapp_opt_in,
    c.whatsapp_snooze_until AS dont_message_until,
    c.secondary_display_name,
    c.secondary_name_prefix,
    c.secondary_phone_e164,
    c.secondary_whatsapp_username,
    c.notes,
    c.m3u_url,
    c.created_at,
    c.updated_at,
    ( SELECT array_agg(a.name) AS array_agg
           FROM client_apps ca
             JOIN apps a ON a.id = ca.app_id
          WHERE ca.client_id = c.id) AS apps_names,
    ( SELECT count(al.id) AS count
           FROM client_alerts al
          WHERE al.client_id = c.id AND al.status = 'OPEN'::text) AS alerts_open,
    c.name_prefix
   FROM clients c
     LEFT JOIN servers s ON s.id = c.server_id
     LEFT JOIN plan_tables pt ON pt.id = c.plan_table_id
  WHERE c.is_archived = false AND c.is_trial = true;

CREATE OR REPLACE VIEW vw_trials_list_archived AS
 SELECT c.id,
    c.tenant_id,
    c.display_name AS client_name,
    c.server_username AS username,
    c.server_password,
    c.vencimento,
    'ARCHIVED'::text AS computed_status,
    c.is_archived AS client_is_archived,
    c.screens,
    c.plan_label AS plan_name,
    c.plan_table_id,
    pt.name AS plan_table_name,
    c.price_amount,
    c.price_currency,
    c.server_id,
    s.name AS server_name,
    c.technology,
    c.phone_e164 AS whatsapp_e164,
    c.whatsapp_username,
    c.whatsapp_opt_in,
    c.whatsapp_snooze_until AS dont_message_until,
    c.secondary_display_name,
    c.secondary_name_prefix,
    c.secondary_phone_e164,
    c.secondary_whatsapp_username,
    c.notes,
    c.m3u_url,
    c.created_at,
    c.updated_at,
    ( SELECT array_agg(a.name) AS array_agg
           FROM client_apps ca
             JOIN apps a ON a.id = ca.app_id
          WHERE ca.client_id = c.id) AS apps_names,
    ( SELECT count(al.id) AS count
           FROM client_alerts al
          WHERE al.client_id = c.id AND al.status = 'OPEN'::text) AS alerts_open,
    c.name_prefix
   FROM clients c
     LEFT JOIN servers s ON s.id = c.server_id
     LEFT JOIN plan_tables pt ON pt.id = c.plan_table_id
  WHERE c.is_archived = true AND c.is_trial = true;

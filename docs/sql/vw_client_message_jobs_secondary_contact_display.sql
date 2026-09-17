-- 17/09/2026, pedido do Márcio (achado real: Raul/Marcela — a Auditoria
-- mostrava "Raul" e o telefone dele nas DUAS linhas, mesmo quando a 2ª
-- mensagem foi de verdade pro contato SECUNDÁRIO dela). A view sempre
-- pegava c.display_name/c.whatsapp_username do cliente, sem checar
-- j.secondary_only — corrigido pra mostrar o nome/telefone secundário
-- quando o job é secondary_only=true, igual o envio real já faz
-- (envio_programado/route.ts:477-479 já filtra o telefone certo pra
-- ENVIAR; só a exibição na Auditoria não acompanhava isso).
CREATE OR REPLACE VIEW vw_client_message_jobs_queue_details AS
SELECT j.id,
    j.tenant_id,
    j.status,
    to_char((j.send_at AT TIME ZONE 'America/Sao_Paulo'::text), 'DD/MM/YYYY HH24:MI:SS'::text) AS when_sp,
    j.send_at AS when_ts_utc,
    CASE
        WHEN j.automation_id IS NULL THEN 'MANUAL'::text
        ELSE 'AUTOMACAO'::text
    END AS origem,
    j.client_id,
    CASE
        WHEN j.secondary_only THEN COALESCE(c.secondary_display_name, c.display_name)
        ELSE c.display_name
    END AS client_name,
    CASE
        WHEN j.secondary_only THEN COALESCE(c.secondary_whatsapp_username, c.whatsapp_username)
        ELSE c.whatsapp_username
    END AS whatsapp_username,
    j.automation_id,
    COALESCE(mt_job.name, mt_auto.name) AS template_name,
    "left"(COALESCE(j.message, ''::text), 140) AS message_preview,
    j.message AS message_full,
    j.whatsapp_session,
    j.error_message,
    j.secondary_only
FROM client_message_jobs j
LEFT JOIN clients c ON c.id = j.client_id AND c.tenant_id = j.tenant_id
LEFT JOIN billing_automations a ON a.id = j.automation_id AND a.tenant_id = j.tenant_id
LEFT JOIN message_templates mt_auto ON mt_auto.id = a.message_template_id AND mt_auto.tenant_id = j.tenant_id
LEFT JOIN message_templates mt_job ON mt_job.id = j.message_template_id AND mt_job.tenant_id = j.tenant_id;

-- Outro resquício do antigo sistema de papéis (master/admin/user), achado
-- durante a auditoria dos exports/imports (billing_automations referencia
-- message_templates). Nenhum código do app lê master_only, nenhuma policy
-- de RLS depende dela, e as 22 linhas existentes têm o valor false.
ALTER TABLE message_templates
  DROP COLUMN master_only;

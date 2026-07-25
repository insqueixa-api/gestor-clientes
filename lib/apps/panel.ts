// lib/apps/panel.ts
// Helpers compartilhados entre app/api/client-portal/apps/{configure,remove}
// — espelham a lógica de resolveIntegration/getMacFromApp/getDeviceKeyFromApp
// de app/admin/cliente/novo_cliente.tsx, mas server-side (sem state do React).

// Handlers cujo campo "password" do payload é o PIN da integração
// (app_integrations.pin), não a senha real do cliente — mesma regra do admin.
export const PIN_HANDLERS = new Set(["DUPLECAST", "IBOSOL", "IBOPRO"]);

// Handlers cuja rota de integração já implementa action:"check" (consulta
// só leitura do vencimento real, sem criar/alterar nada). QuickPlayer não
// rastreia vencimento no painel (o campo "date" é preenchido manualmente).
// IBOSOL fica de fora: activation.iboplayer.com bloqueia a ação de check
// com um desafio Cloudflare que nem Playwright real (headless ou headed)
// consegue passar — mesma assinatura de detecção de automação do Elite,
// investigado e confirmado sem solução via código em 21-22/07/2026.
export const CHECK_VALIDITY_HANDLERS = new Set(["DUPLECAST", "IBOPRO", "GERENCIAAPP"]);

// Igual ao CHECK_VALIDITY_HANDLERS acima, mas pro botão "Verificar
// vencimento" do ADMIN (novo_cliente.tsx) — que também inclui IBOSOL, cujo
// check roda via extensão do Chrome (só existe no navegador do admin, por
// isso não pode entrar no CHECK_VALIDITY_HANDLERS do portal do cliente).
export const ADMIN_CHECK_HANDLERS = new Set(["DUPLECAST", "IBOPRO", "GERENCIAAPP", "IBOSOL"]);

export function extractFieldByType(fieldsConfig: any[], values: Record<string, any>, type: string) {
  const field = (fieldsConfig || []).find(
    (f: any) =>
      String(f?.type || "").toLowerCase() === type ||
      (type === "device_key" && String(f?.label || "").toLowerCase().includes("device key")),
  );
  if (!field) return "";
  const key = String(field.id || field.label || "").trim();
  return values?.[key] || "";
}

export function findFieldByType(fieldsConfig: any[], type: string) {
  return (fieldsConfig || []).find((f: any) => String(f?.type || "").toLowerCase() === type) || null;
}

// Extrai só a data (YYYY-MM-DD) de uma string vinda do painel de um
// parceiro — sem NUNCA passar por `new Date()`/getters locais. Cada painel
// já manda a data pronta (no fuso dele); reinterpretar via Date() é
// exatamente o que causava vencimento salvo um dia a menos/a mais
// dependendo do fuso do processo que rodava o código. Aceita
// "YYYY-MM-DD..." e "DD/MM/YYYY..." (com ou sem hora/segundos junto).
export function extractDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  return null;
}

// Eventos do Bloco 3 do portal (/renew-beta) que hoje ficavam 100% invisíveis
// pro admin — client_app_requests só cobre pedidos manuais (apps sem
// integração) e client_portal_payments só cobre pagamento. Grava em
// client_app_activity_log (docs/sql/client_app_activity_log.sql), lido na
// aba "Aplicativos" da Auditoria. Nunca lança — log não pode derrubar a
// ação real do cliente.
export type AppActivityEvent =
  | "added"
  | "removed"
  | "removed_partner_failed"
  | "configured"
  | "configure_failed"
  | "fields_updated"
  | "check_validity"
  | "check_validity_failed";

export async function logAppActivity(
  supabaseAdmin: any,
  params: {
    tenantId: string;
    clientId: string;
    clientAppId?: string | null;
    appName: string;
    event: AppActivityEvent;
    detail?: Record<string, any> | null;
  },
) {
  try {
    await supabaseAdmin.from("client_app_activity_log").insert({
      tenant_id: params.tenantId,
      client_id: params.clientId,
      client_app_id: params.clientAppId || null,
      app_name: params.appName,
      event: params.event,
      detail: params.detail || null,
    });
  } catch {
    // não bloqueia a ação do cliente por falha no log
  }
}

export function internalAppUrl(path: string) {
  const base = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  return `${base}${path}`;
}

// Réplica de buildM3uUrlSilent (novo_cliente.tsx) — domínio aleatório da
// lista de DNS do servidor, mesma regra usada pelo admin.
export function buildM3uUrlFromDns(dnsList: string[], username: string, password: string): string {
  if (!username || !dnsList || dnsList.length === 0) return "";
  const randomDomain = dnsList[Math.floor(Math.random() * dnsList.length)];
  const cleanDomain = randomDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `http://${cleanDomain}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=ts`;
}

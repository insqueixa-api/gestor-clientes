// lib/apps/panel.ts
// Helpers compartilhados entre app/api/client-portal/apps/{configure,remove}
// — espelham a lógica de resolveIntegration/getMacFromApp/getDeviceKeyFromApp
// de app/admin/cliente/novo_cliente.tsx, mas server-side (sem state do React).

// Handlers cujo campo "password" do payload é o PIN da integração
// (app_integrations.pin), não a senha real do cliente — mesma regra do admin.
export const PIN_HANDLERS = new Set(["DUPLECAST", "IBOPRO", "MESSITV", "BOBPLAYER", "IBOPLAYER", "IPTVDUPLEX"]);

// Handlers cuja rota de integração já implementa action:"check" (consulta
// só leitura do vencimento real, sem criar/alterar nada). QuickPlayer não
// rastreia vencimento no painel (o campo "date" é preenchido manualmente).
// DUPLECAST voltou pra cá em 25/07/2026, depois de reescrever a integração
// pro login por dispositivo (mac+device_key,
// /plugin/duplecast/device_login/) — essa tela mostra "Expire on" de
// verdade. Antes, com login de revendedor + relatório client_codes, nunca
// tinha vencimento real pra devolver (client_codes é um relatório de
// códigos de ativação avulsos, sem relação com as playlists xtream criadas
// por essa integração — ver app/api/integrations/apps/duplecast/route.ts).
// MESSITV/BOBPLAYER/IBOPLAYER/IPTVDUPLEX entraram em 27/07/2026: login
// (mac+device_key, com captcha resolvido via Gemini quando o parceiro exige)
// devolve o expire_date real do dispositivo — igual DUPLECAST, sem precisar
// de heurística. DUPLEXTV entrou no mesmo dia mas quase nunca devolve data de
// verdade (o parceiro não tem endpoint de status pra mac já ativado) — fica
// no Set mesmo assim pra habilitar o botão, que trata o "sem data" como caso
// normal (mantém o valor do banco).
export const CHECK_VALIDITY_HANDLERS = new Set(["DUPLECAST", "IBOPRO", "GERENCIAAPP", "MESSITV", "BOBPLAYER", "IBOPLAYER", "IPTVDUPLEX", "DUPLEXTV"]);

// Igual ao CHECK_VALIDITY_HANDLERS acima, mas pro botão "Verificar
// vencimento" do ADMIN (novo_cliente.tsx).
// IBOSOL removido em 27/07/2026 (deixou de existir — DUPLEXTV era o último
// app da família ainda linkado a ela, migrado pro próprio handler
// standalone; ver docs/sql ou memória do projeto pra histórico).
export const ADMIN_CHECK_HANDLERS = new Set(["DUPLECAST", "IBOPRO", "GERENCIAAPP", "MESSITV", "BOBPLAYER", "IBOPLAYER", "IPTVDUPLEX", "DUPLEXTV"]);

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

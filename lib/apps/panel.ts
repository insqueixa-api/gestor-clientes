// lib/apps/panel.ts
// Helpers compartilhados entre app/api/client-portal/apps/{configure,remove}
// — espelham a lógica de resolveIntegration/getMacFromApp/getDeviceKeyFromApp
// de app/admin/cliente/novo_cliente.tsx, mas server-side (sem state do React).

// Handlers cujo campo "password" do payload é o PIN da integração
// (app_integrations.pin), não a senha real do cliente — mesma regra do admin.
export const PIN_HANDLERS = new Set(["DUPLECAST", "IBOPRO", "MESSITV", "BOBPLAYER", "IBOPLAYER", "IPTVDUPLEX", "IPTVPLAYERIO"]);

// Handlers cuja rota de integração já implementa action:"check" (consulta
// só leitura do vencimento real, sem criar/alterar nada). QuickPlayer não
// rastreia vencimento no painel (o campo "date" é preenchido manualmente).
// DUPLECAST faz login por dispositivo (mac+device_key,
// /plugin/duplecast/device_login/), que devolve "Expire on" de verdade.
// MESSITV/BOBPLAYER/IBOPLAYER/IPTVDUPLEX/IPTVPLAYERIO seguem o mesmo padrão
// (login mac+device_key, com captcha resolvido via Gemini quando o
// parceiro exige) e também devolvem o expire_date real do dispositivo.
// IPTVPLAYERIO usa o mesmo backend branco do IPTVDUPLEX (api.iptvplayer.io
// em vez de api.iptvduplex.com), confirmado ao vivo em 28/07/2026. DUPLEXTV
// quase nunca devolve data de verdade (o parceiro não tem endpoint de
// status pra mac já ativado) — fica no Set mesmo assim pra habilitar o
// botão, que trata o "sem data" como caso normal (mantém o valor do
// banco). GERENCIAAPP consulta a playlist pelo nome dentro da família
// completa do MAC (ver app/api/integrations/apps/gerenciaapp/route.ts).
export const CHECK_VALIDITY_HANDLERS = new Set(["DUPLECAST", "IBOPRO", "GERENCIAAPP", "MESSITV", "BOBPLAYER", "IBOPLAYER", "IPTVDUPLEX", "IPTVPLAYERIO", "DUPLEXTV"]);

// Igual ao CHECK_VALIDITY_HANDLERS acima, mas pro botão "Verificar
// vencimento" do ADMIN (novo_cliente.tsx).
export const ADMIN_CHECK_HANDLERS = new Set(["DUPLECAST", "IBOPRO", "GERENCIAAPP", "MESSITV", "BOBPLAYER", "IBOPLAYER", "IPTVDUPLEX", "IPTVPLAYERIO", "DUPLEXTV"]);

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

// Esquema (http/https) salvo no DNS do servidor tem que ser respeitado, não
// forçado — achado com o NaTV (28/07/2026): o domínio passou a exigir
// https, mas o builder sempre forçava http, quebrando a lista de quem
// reconfigurasse depois da troca. Default pra http só quando o DNS salvo
// não tem esquema nenhum (formato antigo, sem prefixo).
function splitScheme(domain: string): { scheme: string; host: string } {
  const m = domain.match(/^(https?):\/\//i);
  return {
    scheme: m ? m[1].toLowerCase() : "http",
    host: domain.replace(/^https?:\/\//i, "").replace(/\/$/, ""),
  };
}

// Réplica de buildM3uUrlSilent (novo_cliente.tsx) — domínio aleatório da
// lista de DNS do servidor, mesma regra usada pelo admin.
export function buildM3uUrlFromDns(dnsList: string[], username: string, password: string): string {
  if (!username || !dnsList || dnsList.length === 0) return "";
  const randomDomain = dnsList[Math.floor(Math.random() * dnsList.length)];
  const { scheme, host } = splitScheme(randomDomain);
  return `${scheme}://${host}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=ts`;
}

// "Secundária" do Reconfigurar (pedido do Márcio, 28/07/2026): sorteia outra
// DNS do servidor e gera um m3u novo — pro NaTV especificamente, usa a
// variação de mirror própria dele (sem "s" + prefixo "r2.", ex:
// https://rj98.eu → http://r2.rj98.eu). Nenhum outro servidor tem esse
// mirror, então essa transformação NUNCA se aplica fora do NaTV (geraria
// uma URL que não existe de verdade). Réplica de generateM3uUrlSecondary
// (novo_cliente.tsx).
export function buildM3uUrlSecondary(dnsList: string[], username: string, password: string, serverName?: string): string {
  if (!username || !dnsList || dnsList.length === 0) return "";
  const isNaTv = String(serverName || "").trim().toUpperCase() === "NATV";
  if (!isNaTv) return buildM3uUrlFromDns(dnsList, username, password);

  const randomDomain = dnsList[Math.floor(Math.random() * dnsList.length)];
  const { host } = splitScheme(randomDomain);
  const mirrorHost = host.toLowerCase().startsWith("r2.") ? host : `r2.${host}`;
  return `http://${mirrorHost}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=ts`;
}

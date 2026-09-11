// lib/integrations/gerenciaapp-proxy.ts
// ✅ 11/09/2026, pedido do Márcio: a string de conexão do proxy residencial
// (IP:porta:usuário:senha da ProxyBR) virou editável direto no card
// ProxyBR (Configurações > API de Integrações > Parceiros), gravada em
// system_config — em vez de fixa na env var GERENCIAAPP_PROXY_URL da
// Vercel, que exigia redeploy toda vez que o IP rotacionasse. Lido aqui
// (com cache de 60s pra não bater no banco em toda chamada) por quem
// precisa do proxy no lado da Vercel; a env var continua como fallback só
// pra nunca quebrar se a linha em system_config ainda não existir.
import { ProxyAgent } from "undici";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const PROXYBR_CONFIG_KEY = "proxybr_connection_string";
const TTL_MS = 60_000;

let cached: { dispatcher: ProxyAgent | undefined; fetchedAt: number } | null = null;

// ✅ Formato "cru" que a própria ProxyBR mostra no painel deles
// (host:porta:usuário:senha, ex: proxy22-br-hz.ipbr.pro:10001:usuario:senha)
// — é o que fica salvo em system_config e o que o Márcio edita no card.
// Convertido aqui pro formato de URL que o ProxyAgent/HttpsProxyAgent
// espera (http://usuario:senha@host:porta). Host pode ter pontos mas NUNCA
// dois-pontos (a ProxyBR sempre expõe o hostname DNS pra isso, nunca o IPv6
// cru, que quebraria esse split simples) — por isso exige exatamente 4
// partes.
export function parseProxyBrRaw(raw: string): { host: string; port: string; user: string; pass: string } | null {
  const parts = String(raw || "").trim().split(":");
  if (parts.length !== 4) return null;
  const [host, port, user, pass] = parts;
  if (!host || !port || !user || !pass) return null;
  return { host, port, user, pass };
}

export function proxyBrRawToUrl(raw: string): string | null {
  const parsed = parseProxyBrRaw(raw);
  if (!parsed) return null;
  return `http://${parsed.user}:${parsed.pass}@${parsed.host}:${parsed.port}`;
}

async function resolveProxyUrl(): Promise<string> {
  let raw = "";
  try {
    const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await sb
      .from("system_config")
      .select("config_value")
      .eq("config_key", PROXYBR_CONFIG_KEY)
      .maybeSingle<{ config_value: string | null }>();
    raw = String(data?.config_value || "").trim();
  } catch {
    // best-effort — cai pro env var abaixo
  }
  if (raw) {
    const url = proxyBrRawToUrl(raw);
    if (url) return url;
  }
  // Fallback: env var antiga (ou já no formato de URL pronta, legado)
  return String(process.env.GERENCIAAPP_PROXY_URL || "").trim();
}

export async function getGerenciaAppProxyDispatcher(): Promise<ProxyAgent | undefined> {
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.dispatcher;

  const url = await resolveProxyUrl();
  const dispatcher = url ? new ProxyAgent(url) : undefined;
  cached = { dispatcher, fetchedAt: Date.now() };
  return dispatcher;
}

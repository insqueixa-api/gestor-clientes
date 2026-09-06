// lib/whatsapp/wa-context.ts
import { createClient } from "@/lib/supabase/server";
import { getAdminTenantContext } from "@/lib/api/auth-server";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { flagSuspiciousAccess } from "@/lib/observability";

export type SessionNumber = 1 | 2;

export function makeSessionKey(tenantId: string, userId: string, session: SessionNumber = 1) {
  const input = session === 2
    ? `${tenantId}:${userId}:2`
    : `${tenantId}:${userId}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

export interface WAContext {
  baseUrl: string;
  token: string;
  sessionKey: string;
  headers: Record<string, string>;
  // ✅ 05/09/2026: expostos pra quem precisa gravar algo no banco associado
  // ao tenant (ex: checkWhatsAppSessionErrors em system-health-check/
  // route.ts) sem ter que resolver o tenant de novo separadamente.
  tenantId: string;
  userId: string;
}

type CronTenantSelection = {
  tenantId: string;
  userId: string;
};

export function resolveCronTenantSelection(
  rows: Array<{ tenant_id?: string | null; user_id?: string | null } | null | undefined>,
  explicitTenantId?: string,
): CronTenantSelection | null {
  const normalized = (rows || [])
    .filter(Boolean)
    .map((row) => ({
      tenantId: String(row?.tenant_id || "").trim(),
      userId: String(row?.user_id || "").trim(),
    }))
    .filter(({ tenantId, userId }) => !!tenantId && !!userId);

  if (!normalized.length) return null;

  if (explicitTenantId) {
    const match = normalized.find((row) => row.tenantId === explicitTenantId);
    if (match) return match;
  }

  const uniqueTenants = [...new Set(normalized.map((row) => row.tenantId))];
  if (uniqueTenants.length !== 1) return null;

  return normalized.find((row) => row.tenantId === uniqueTenants[0]) ?? null;
}

function buildWAContext(baseUrl: string, token: string, tenantId: string, userId: string, session: SessionNumber): WAContext {
  const sessionKey = makeSessionKey(tenantId, userId, session);
  return {
    baseUrl,
    token,
    sessionKey,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-session-key": sessionKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    tenantId,
    userId,
  };
}

export async function getWAContext(session: SessionNumber = 1): Promise<WAContext | null> {
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL;
  const token = process.env.UNIGESTOR_WA_TOKEN;
  if (!baseUrl || !token) return null;

  const ctx = await getAdminTenantContext();
  if (!ctx.ok) return null;

  return buildWAContext(baseUrl, token, ctx.tenantId, ctx.userId, session);
}

// ✅ verifica se a chamada veio do cron (header com o segredo), não do navegador
function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_CONTROL_SECRET;
  if (!secret) return false;
  const header = req.headers.get("x-cron-secret") || "";
  if (!header) return false;
  if (header.length !== secret.length) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return crypto.timingSafeEqual(a, b);
}

async function getCronTenantContext(req: Request): Promise<CronTenantSelection | null> {
  if (!isCronRequest(req)) return null;

  const explicitTenantId = String(process.env.WHATSAPP_CRON_TENANT_ID || "").trim() || undefined;
  const { createClient: createAdminClient } = await import("@supabase/supabase-js");
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data, error } = await supabaseAdmin
    .from("tenant_members")
    .select("tenant_id, user_id")
    .limit(200);

  if (error || !data) {
    flagSuspiciousAccess("cron_whatsapp_tenant_lookup_failed", { error: error?.message || "unknown" });
    return null;
  }

  const selected = resolveCronTenantSelection(data, explicitTenantId);
  if (!selected) {
    flagSuspiciousAccess("cron_whatsapp_tenant_ambiguous", { explicitTenantId: explicitTenantId || null });
  }
  return selected;
}

// ✅ mesma lógica do getWAContext, mas aceita também chamadas do cron. Para
// evitar seleção arbitrária quando o sistema tiver mais de um tenant, o cron
// só funciona quando há um tenant explícito configurado ou um único tenant
// válido na tabela.
export async function getWAContextOrCron(
  req: Request,
  session: SessionNumber = 1,
): Promise<WAContext | null> {
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL;
  const token = process.env.UNIGESTOR_WA_TOKEN;
  if (!baseUrl || !token) return null;

  const tenantContext = isCronRequest(req)
    ? await getCronTenantContext(req)
    : null;

  if (!tenantContext) {
    const ctx = await getAdminTenantContext();
    if (!ctx.ok) return null;
    return buildWAContext(baseUrl, token, ctx.tenantId, ctx.userId, session);
  }

  return buildWAContext(baseUrl, token, tenantContext.tenantId, tenantContext.userId, session);
}

// ✅ checagem segura pra rotas que não usam WAContext (reboot, restart-service)
// — aceita sessão de navegador admin OU o segredo do cron com tenant explícito
// ou tenant único na tabela.
export async function requireUserOrCron(req: Request): Promise<boolean> {
  if (isCronRequest(req)) {
    const cronCtx = await getCronTenantContext(req);
    return !!cronCtx;
  }

  const ctx = await getAdminTenantContext();
  return ctx.ok;
}

interface ProxyResult {
  ok: boolean;
  status: number;
  json: any;
}

/** Faz fetch para a VM com timeout de 12s e parsing seguro */
export async function proxyVM(
  ctx: WAContext,
  path: string,
  init: RequestInit = {}
): Promise<ProxyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(`${ctx.baseUrl}${path}`, {
      ...init,
      headers: { ...ctx.headers, ...(init.headers as Record<string, string> ?? {}) },
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await res.text();
    let json: any = {};
    try { json = raw ? JSON.parse(raw) : {}; } catch {}

    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

// Respostas de erro padronizadas
export const err = (msg: string, status: number) =>
  NextResponse.json({ error: msg }, { status });

export const errEnv  = () => err("ENV ausente: UNIGESTOR_WA_BASE_URL / UNIGESTOR_WA_TOKEN", 500);
export const errAuth = () => err("Não autenticado", 401);
export const errVM   = (e: any) =>
  NextResponse.json(
    { error: e?.name === "AbortError" ? "Timeout ao conectar na VM" : e?.message || "Falha na VM" },
    { status: 500 }
  );
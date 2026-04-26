import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import crypto from "crypto";

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
}

export async function getWAContext(session: SessionNumber = 1): Promise<WAContext | null> {
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL;
  const token   = process.env.UNIGESTOR_WA_TOKEN;
  if (!baseUrl || !token) return null;

  const supabase = await createClient();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return null;

  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member?.tenant_id) return null;

  const sessionKey = makeSessionKey(member.tenant_id, user.id, session);

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
  };
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
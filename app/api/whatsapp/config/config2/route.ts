import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function makeSessionKey2(tenantId: string, userId: string) {
  return crypto.createHash("sha256").update(`${tenantId}:${userId}:2`).digest("hex");
}

async function getSessionHeaders() {
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL;
  const token = process.env.UNIGESTOR_WA_TOKEN;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: member } = await supabase
    .from("tenant_members").select("tenant_id").eq("user_id", user.id).maybeSingle();
  if (!member?.tenant_id) return null;
  const sessionKey = makeSessionKey2(member.tenant_id, user.id); // ✅ único diff
  return {
    baseUrl, token, sessionKey,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-session-key": sessionKey,
      "Content-Type": "application/json",
    }
  };
}

export async function GET() {
  const ctx = await getSessionHeaders();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const res = await fetch(`${ctx.baseUrl}/session-config`, {
    headers: ctx.headers, cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}

export async function POST(req: Request) {
  const ctx = await getSessionHeaders();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${ctx.baseUrl}/session-config`, {
    method: "POST",
    headers: ctx.headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
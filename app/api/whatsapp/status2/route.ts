import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function makeSessionKey2(tenantId: string, userId: string) {
  return crypto.createHash("sha256").update(`${tenantId}:${userId}:2`).digest("hex");
}

export async function GET() {
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL;
  const token   = process.env.UNIGESTOR_WA_TOKEN;
  if (!baseUrl || !token) return NextResponse.json({ error: "ENV ausente" }, { status: 500 });

  const supabase = await createClient();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data: member } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", user.id).maybeSingle();
  if (!member?.tenant_id) return NextResponse.json({ error: "Tenant não encontrado" }, { status: 403 });

  const sessionKey = makeSessionKey2(member.tenant_id, user.id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${baseUrl}/status`, {
      headers: { Authorization: `Bearer ${token}`, "x-session-key": sessionKey, Accept: "application/json" },
      cache: "no-store", signal: controller.signal,
    });
    const raw = await res.text();
    let json: any = {};
    try { json = raw ? JSON.parse(raw) : {}; } catch {}
    if (!res.ok) return NextResponse.json({ error: json?.error || "Falha" }, { status: res.status });
    return NextResponse.json({ connected: !!json.connected, status: json.status ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.name === "AbortError" ? "Timeout" : e?.message }, { status: 500 });
  } finally { clearTimeout(timeout); }
}
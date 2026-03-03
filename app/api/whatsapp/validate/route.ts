import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function makeSessionKey(tenantId: string, userId: string) {
  return crypto.createHash("sha256").update(`${tenantId}:${userId}`).digest("hex");
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
  const sessionKey = makeSessionKey(member.tenant_id, user.id);
  return {
    baseUrl, sessionKey,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-session-key": sessionKey,
      "Content-Type": "application/json",
    }
  };
}

export async function POST(req: Request) {
  const ctx = await getSessionHeaders();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { phone } = await req.json().catch(() => ({}));
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  const res = await fetch(`${ctx.baseUrl}/validate`, {
    method: "POST",
    headers: ctx.headers,
    body: JSON.stringify({ phone }),
  });

  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
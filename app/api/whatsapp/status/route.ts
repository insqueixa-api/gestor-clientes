import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function makeSessionKey(tenantId: string, userId: string) {
  // hash curto, não vaza ids em logs
  return crypto.createHash("sha256").update(`${tenantId}:${userId}`).digest("hex");
}

export async function GET() {
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL; // ex: http://34.136.237.69:3000
  const token = process.env.UNIGESTOR_WA_TOKEN;

  if (!baseUrl || !token) {
    return NextResponse.json(
      { error: "ENV ausente: UNIGESTOR_WA_BASE_URL / UNIGESTOR_WA_TOKEN" },
      { status: 500 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { data: member, error: memErr } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }
  if (!member?.tenant_id) {
    return NextResponse.json(
      { error: "Tenant não encontrado para este usuário" },
      { status: 403 }
    );
  }

  const sessionKey = makeSessionKey(member.tenant_id, user.id);

  // ✅ timeout duro (evita request pendurado quando VM dá freeze)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(`${baseUrl}/status`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-session-key": sessionKey,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    // ✅ tenta JSON, mas não quebra se VM devolver HTML/texto
    const raw = await res.text();
    let json: any = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = {};
    }

    if (!res.ok) {
      const msg =
        json?.error ||
        (raw
          ? `Falha ao consultar status na VM: ${raw.slice(0, 200)}`
          : "Falha ao consultar status na VM");

      return NextResponse.json({ error: msg }, { status: res.status });
    }

    // ✅ padroniza payload pro front
    return NextResponse.json(
      {
        connected: !!json.connected,
        status: json.status ?? null, // "connected" | "qr" | "disconnected"
      },
      { status: 200 }
    );
  } catch (e: any) {
    const isAbort = e?.name === "AbortError";
    return NextResponse.json(
      { error: isAbort ? "Timeout ao consultar status na VM" : e?.message || "Falha ao conectar na VM" },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

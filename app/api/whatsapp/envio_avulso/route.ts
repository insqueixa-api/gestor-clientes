// app/api/whatsapp/envio_avulso/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { makeSessionKey } from "@/lib/whatsapp/wa-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export async function POST(req: Request) {
  const baseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!baseUrl || !waToken || !supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Auth
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = createClient(supabaseUrl, serviceKey);
  const { data: authData, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !authData?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const authedUserId = authData.user.id;

  // Body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String(body.tenant_id || "").trim();
  const phone = String(body.phone || "").trim();
  const message = String(body.message || "").trim();
  const whatsappSession = String(body.whatsapp_session || "default").trim();

  if (!tenantId || !phone || !message) {
    return NextResponse.json(
      { error: "tenant_id, phone e message são obrigatórios" },
      { status: 400 },
    );
  }

  // Valida membro do tenant
  const { data: mem } = await sb
    .from("tenant_members")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", authedUserId)
    .maybeSingle();

  if (!mem) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Normaliza número — aceita qualquer formato
  let digits = phone.replace(/\D/g, "");
if (digits.length < 8) {
  return NextResponse.json({ error: "Número inválido" }, { status: 400 });
}

// Normaliza para E.164 completo (o que a VM espera)
// Formato banco BR: "02197163313" (11 dígitos, começa com 0) → "5521979163313"
if (digits.startsWith("0") && digits.length <= 12) {
  digits = "55" + digits.slice(1); // remove o 0, adiciona 55
}
// Número BR sem DDI e sem zero: "21979163313" (11 dígitos)
else if (digits.length === 11 && !digits.startsWith("55")) {
  digits = "55" + digits;
}
// Número BR sem DDI e sem zero: "2197916331" (10 dígitos — fixo)
else if (digits.length === 10 && !digits.startsWith("55")) {
  digits = "55" + digits;
}

  const sessionNumber = whatsappSession === "session2" ? 2 : 1;
const sessionKey = makeSessionKey(tenantId, authedUserId, sessionNumber);

try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${waToken}`,
        "x-session-key": sessionKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ phone: digits, message }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const raw = await res.text();
  let parsed: any = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}

  if (!res.ok || (parsed && (parsed.ok === false || !!parsed.error))) {
    return NextResponse.json(
      { error: parsed?.error || raw || "Falha ao enviar" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, phone: digits });
} catch (err: any) {
  const isTimeout = err?.name === "AbortError";
  return NextResponse.json(
    { error: isTimeout ? "Timeout ao conectar na VM" : err?.message || "Erro" },
    { status: isTimeout ? 504 : 500 },
  );
}
}
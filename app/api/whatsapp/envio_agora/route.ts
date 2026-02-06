import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function makeSessionKey(tenantId: string, userId: string) {
  return crypto.createHash("sha256").update(`${tenantId}:${userId}`).digest("hex");
}

function normalizeToPhone(usernameRaw: unknown): string {
  // username hoje = telefone (pode vir com +, espaços, etc)
  const s = String(usernameRaw ?? "").trim();
  const digits = s.replace(/[^\d]/g, "");
  return digits;
}

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

type SendNowBody = {
  tenant_id: string;
  client_id: string;
  message: string;
  whatsapp_session?: string | null; // mantido, mesmo não sendo usado aqui
};

async function fetchClientWhatsApp(sb: any, tenantId: string, clientId: string) {
  // ✅ SEMPRE pega da view consolidada
  const { data, error } = await sb
    .from("vw_clients_list")
    .select("id, tenant_id, whatsapp_username, whatsapp_opt_in, dont_message_until")
    .eq("tenant_id", tenantId)
    .eq("id", clientId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Cliente não encontrado na vw_clients_list");

  const phone = normalizeToPhone(data.whatsapp_username);
  return {
    phone,
    whatsapp_opt_in: data.whatsapp_opt_in === true,
    dont_message_until: data.dont_message_until as string | null,
  };
}

export async function POST(req: Request) {
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL!;
  const waToken = process.env.UNIGESTOR_WA_TOKEN!;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const sb = createClient(supabaseUrl, serviceKey);

  // =========================
  // 1) Autorização: USER
  // =========================
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authedUserId = data.user.id;

  // =========================
  // 2) Body
  // =========================
  let body: SendNowBody;
  try {
    body = (await req.json()) as SendNowBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String((body as any).tenant_id || "").trim();
  const clientId = String((body as any).client_id || "").trim();
  const message = String((body as any).message || "").trim();

  if (!tenantId || !clientId || !message) {
    return NextResponse.json({ error: "tenant_id, client_id e message são obrigatórios" }, { status: 400 });
  }

  // ✅ pega SEMPRE do CLIENTE na vw_clients_list
  const wa = await fetchClientWhatsApp(sb, tenantId, clientId);

  if (!wa.phone) {
    return NextResponse.json({ error: "Cliente sem whatsapp_username" }, { status: 400 });
  }

  if (!wa.whatsapp_opt_in) {
    return NextResponse.json({ error: "Cliente não permite receber mensagens" }, { status: 400 });
  }

  if (wa.dont_message_until) {
    const until = new Date(wa.dont_message_until);

    // Se a data for inválida, bloqueia mesmo assim (melhor do que deixar passar lixo)
    if (isNaN(until.getTime())) {
      return NextResponse.json(
        { error: `Cliente não quer receber mensagens (data inválida): ${wa.dont_message_until}` },
        { status: 409 }
      );
    }

    // Só bloqueia se a pausa estiver no FUTURO
    if (until > new Date()) {
      const formatted = until.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      return NextResponse.json(
        { error: `Cliente não quer receber mensagens até: ${formatted}` },
        { status: 409 }
      );
    }
  }

  // ✅ sessionKey é do usuário logado (não influencia destino)
  const sessionKey = makeSessionKey(tenantId, authedUserId);

  // ✅ LOG (ajuste sugerido)
  console.log("[WA][send_now]", {
    tenantId,
    clientId,
    to: wa.phone,
    authedUserId,
  });

  const res = await fetch(`${baseUrl}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${waToken}`,
      "x-session-key": sessionKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      phone: wa.phone,
      message,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    return NextResponse.json({ error: raw || "Falha ao enviar" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, to: wa.phone });
}

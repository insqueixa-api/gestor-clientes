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

type ScheduleBody = {
  tenant_id: string;
  client_id: string;
  message: string;
  send_at: string; // ISO
  whatsapp_session?: string | null;
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
  // 1) Autorização: CRON ou USER
  // =========================
  const cronSecret = process.env.UNIGESTOR_CRON_SECRET;
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  let authedUserId: string | null = null;

  if (!isCron) {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    authedUserId = data.user.id;
  }

  // =========================
  // 2) CRON: processa fila
  // =========================
  if (isCron) {
    const { data: jobs, error: jobsErr } = await sb
      .from("client_message_jobs")
      .select("id, tenant_id, client_id, whatsapp_session, message, send_at, created_by")
      .in("status", ["QUEUED", "SCHEDULED"])
      .lte("send_at", new Date().toISOString())
      .order("send_at", { ascending: true })
      .limit(30);

    if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });
    if (!jobs?.length) return NextResponse.json({ ok: true, processed: 0 });

    let processed = 0;

    for (const job of jobs) {
      try {
        const wa = await fetchClientWhatsApp(sb, job.tenant_id, job.client_id);

        if (!wa.phone) {
          await sb
            .from("client_message_jobs")
            .update({
              status: "FAILED",
              error_message: "Cliente sem whatsapp_username",
            })
            .eq("id", job.id);
          continue;
        }

        if (!wa.whatsapp_opt_in) {
          await sb
            .from("client_message_jobs")
            .update({
              status: "FAILED",
              error_message: "Cliente não opt-in",
            })
            .eq("id", job.id);
          continue;
        }

        if (wa.dont_message_until) {
          const until = new Date(wa.dont_message_until);
          if (!isNaN(until.getTime()) && until > new Date()) continue;
          if (isNaN(until.getTime())) continue; // opcional: trata inválida como bloqueio
        }

        const sessionUserId = String(job.created_by || "system");
        const sessionKey = makeSessionKey(job.tenant_id, sessionUserId);

        // ✅ LOG (ajuste sugerido)
        console.log("[WA][cron_send]", {
          jobId: job.id,
          tenantId: job.tenant_id,
          clientId: job.client_id,
          to: wa.phone,
          createdBy: job.created_by,
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
            message: job.message,
          }),
        });

        const raw = await res.text();
        if (!res.ok) {
          await sb
            .from("client_message_jobs")
            .update({
              status: "FAILED",
              error_message: raw.slice(0, 500),
            })
            .eq("id", job.id);
          continue;
        }

        await sb
          .from("client_message_jobs")
          .update({
            status: "SENT",
            sent_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", job.id);

        processed++;
      } catch (e: any) {
        await sb
          .from("client_message_jobs")
          .update({
            status: "FAILED",
            error_message: e?.message || "Falha ao processar job",
          })
          .eq("id", job.id);
      }
    }

    return NextResponse.json({ ok: true, processed });
  }

  // =========================
  // 3) FRONT: agenda (insere job)
  // =========================
  let body: ScheduleBody;
  try {
    body = (await req.json()) as ScheduleBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String((body as any).tenant_id || "").trim();
  const clientId = String((body as any).client_id || "").trim();
  const message = String((body as any).message || "").trim();
  const sendAt = String((body as any).send_at || "").trim();

  if (!tenantId || !clientId || !message || !sendAt) {
    return NextResponse.json({ error: "tenant_id, client_id, message e send_at são obrigatórios" }, { status: 400 });
  }

  // ✅ validações iguais ao dispatch (mantidas)
  const wa = await fetchClientWhatsApp(sb, tenantId, clientId);

  if (!wa.phone) {
    return NextResponse.json({ error: "Cliente sem whatsapp_username" }, { status: 400 });
  }

  if (!wa.whatsapp_opt_in) {
    return NextResponse.json({ error: "Cliente não permite receber mensagens" }, { status: 400 });
  }

  if (wa.dont_message_until) {
    const until = new Date(wa.dont_message_until);

    if (isNaN(until.getTime())) {
      return NextResponse.json(
        { error: `Cliente não quer receber mensagens (data inválida): ${wa.dont_message_until}` },
        { status: 409 }
      );
    }

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

  const { error } = await sb.from("client_message_jobs").insert({
    tenant_id: tenantId,
    client_id: clientId,
    message,
    send_at: sendAt,
    status: "SCHEDULED",
    whatsapp_session: (body as any).whatsapp_session ?? "default",
    created_by: authedUserId, // ✅ auditoria
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

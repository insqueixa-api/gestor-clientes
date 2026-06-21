// app/api/whatsapp/bot/find-client/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { normalizeToPhone } from "@/lib/whatsapp/template-vars";

export const dynamic = "force-dynamic";

function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
  }
}

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

// ✅ Mesma checagem timing-safe usada no GET do envio_programado
function isInternalAuth(req: Request): boolean {
  const secret = String(process.env.UNIGESTOR_BOT_INTERNAL_SECRET || "").trim();
  const provided = String(req.headers.get("x-internal-secret") || "").trim();
  if (!secret || !provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!isInternalAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = makeSupabaseAdmin();
  if (!sb) {
    safeServerLog("[bot][find-client] Server misconfigured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String(body?.tenant_id || "").trim();
  const rawPhone = String(body?.phone || "").trim();

  if (!tenantId || !rawPhone) {
    return NextResponse.json({ error: "tenant_id e phone são obrigatórios" }, { status: 400 });
  }

  const phone = normalizeToPhone(rawPhone);
  if (!phone || phone.length < 8) {
    return NextResponse.json({ ok: true, matches: [] });
  }

  const { data, error } = await sb
    .from("clients")
    .select(
      `
      id,
      display_name,
      secondary_display_name,
      whatsapp_username,
      secondary_whatsapp_username,
      vencimento,
      screens,
      plan_label,
      plan_table_id,
      price_amount,
      price_currency,
      technology,
      server_id,
      is_trial,
      is_archived,
      servers (name)
    `
    )
    .eq("tenant_id", tenantId)
    .or(`whatsapp_username.eq.${phone},secondary_whatsapp_username.eq.${phone}`);

  if (error) {
    safeServerLog("[bot][find-client] query error", error.message);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }

  const matches = (data || []).map((row: any) => {
    const isSecondary = row.secondary_whatsapp_username === phone;
    return {
      client_id: row.id,
      is_secondary: isSecondary,
      display_name: isSecondary
        ? row.secondary_display_name || row.display_name || "Cliente"
        : row.display_name || "Cliente",
      vencimento: row.vencimento,
      screens: row.screens || 1,
      plan_label: row.plan_label || "Mensal",
      plan_table_id: row.plan_table_id,
      price_amount: row.price_amount || 0,
      price_currency: row.price_currency || "BRL",
      technology: row.technology || "IPTV",
      server_id: row.server_id || null,
      server_name: row.servers?.name || "Servidor",
      is_trial: !!row.is_trial,
      is_archived: !!row.is_archived,
    };
  });

  return NextResponse.json({ ok: true, matches });
}
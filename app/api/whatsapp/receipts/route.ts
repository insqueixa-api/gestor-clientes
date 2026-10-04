// app/api/whatsapp/receipts/route.ts
// ✅ 04/10/2026, pedido do Márcio: guardar o recibo (✓✓ entregue / ✓✓ azul
// lido) de cada mensagem pra mostrar no Histórico da Automação de Cobrança.
// A VM (sessionManager.js::queueReceipt) junta os recibos que a WhatsApp
// manda e chama esta rota em lote. Grava em whatsapp_message_receipts via
// whatsapp_receipt_apply (docs/sql/whatsapp_message_receipts.sql).
//
// Autenticação: mesmo segredo compartilhado da session-alert
// (UNIGESTOR_WA_TOKEN no app = API_TOKEN na VM).
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 500;

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAuthorized(req: NextRequest): boolean {
  const expected = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  return timingSafeEqualStr(token, expected);
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const raw = Array.isArray(body?.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const items = raw
    .map((it: any) => ({
      id: String(it?.id || "").slice(0, 128),
      delivered: isoOrNull(it?.delivered),
      read: isoOrNull(it?.read),
      retries: Math.max(0, Math.min(1000, Number(it?.retries) || 0)),
      error: it?.error ? String(it.error).slice(0, 300) : null,
    }))
    .filter((it: any) => it.id);

  if (items.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  const sb = createAdminClient(
    String(process.env.NEXT_PUBLIC_SUPABASE_URL || ""),
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || ""),
  );
  const { error } = await sb.rpc("whatsapp_receipt_apply", { p_items: items });
  if (error) {
    console.error("[WA][receipts] falha ao gravar recibos", error.message);
    return NextResponse.json({ ok: false, error: "Falha ao gravar" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, applied: items.length });
}

// app/api/whatsapp/allowed-backup/route.ts
// Backup/restore manual da lista "Números Permitidos" (ver
// docs/sql/whatsapp_allowed_numbers_backup.sql) — segunda camada de
// segurança pra não depender só do arquivo em disco da VM.
import { NextResponse } from "next/server";
import { getAdminTenantContext } from "@/lib/api/auth-server";
import { adminSupabase } from "@/lib/api/auth";
import type { SessionNumber } from "@/lib/whatsapp/wa-context";

export const dynamic = "force-dynamic";

function sessionLabel(session: SessionNumber): "principal" | "secundario" {
  return session === 2 ? "secundario" : "principal";
}

function parseSession(raw: string | null): SessionNumber {
  return raw === "2" ? 2 : 1;
}

export async function GET(req: Request) {
  const ctx = await getAdminTenantContext();
  if (!ctx.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const session = parseSession(new URL(req.url).searchParams.get("session"));
  const sb = adminSupabase();
  const { data, error } = await sb
    .from("whatsapp_allowed_numbers_backup")
    .select("allowed_numbers, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("session_label", sessionLabel(session))
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    allowedNumbers: (data?.allowed_numbers as string[] | null) ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}

export async function POST(req: Request) {
  const ctx = await getAdminTenantContext();
  if (!ctx.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const session = parseSession(body?.session === "2" ? "2" : null);
  const allowedNumbers = Array.isArray(body?.allowedNumbers)
    ? body.allowedNumbers.filter((v: unknown) => typeof v === "string")
    : [];

  const sb = adminSupabase();
  const { error } = await sb.from("whatsapp_allowed_numbers_backup").upsert(
    {
      tenant_id: ctx.tenantId,
      session_label: sessionLabel(session),
      allowed_numbers: allowedNumbers,
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    },
    { onConflict: "tenant_id,session_label" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: allowedNumbers.length });
}

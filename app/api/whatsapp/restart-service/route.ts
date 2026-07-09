// app/api/whatsapp/restart-service/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireUserOrCron } from "@/lib/whatsapp/wa-context";

export async function POST(req: Request) {
  const authorized = await requireUserOrCron(req);
  if (!authorized) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const baseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  if (!baseUrl || !waToken) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/system/restart`, {
      method: "POST",
      headers: { Authorization: `Bearer ${waToken}` },
    });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao reiniciar serviço" }, { status: 502 });
  }
}
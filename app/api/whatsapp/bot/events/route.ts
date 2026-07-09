// app/api/whatsapp/bot/events/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const baseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();

  if (!baseUrl || !waToken) {
    return NextResponse.json({ error: "WA env vars ausentes" }, { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/bot-events`, {
      headers: {
        Authorization: `Bearer ${waToken}`,
        "x-session-key": "",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Erro ao buscar eventos" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
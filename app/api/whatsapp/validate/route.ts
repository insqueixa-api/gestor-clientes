import { NextRequest, NextResponse } from "next/server";
import { getSessionHeaders } from "@/lib/whatsapp/session";

export async function POST(req: NextRequest) {
  const ctx = await getSessionHeaders();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { phone } = await req.json().catch(() => ({}));
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  const res = await fetch(`${ctx.baseUrl}/validate-number`, {
    method: "POST",
    headers: ctx.headers,
    body: JSON.stringify({ phone }),
  });

  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
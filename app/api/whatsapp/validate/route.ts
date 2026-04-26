import { NextResponse } from "next/server";
import { getWAContext, proxyVM } from "@/lib/whatsapp/wa-context";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx1 = await getWAContext(1);
  if (!ctx1) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { phone } = await req.json().catch(() => ({}));
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  try {
    // Tentativa 1: Sessão 1
    const r1 = await proxyVM(ctx1, "/validate", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });

    if (r1.ok) return NextResponse.json(r1.json, { status: r1.status });

    // Fallback: Sessão 2 (se sessão 1 não estiver conectada)
    console.log("[WA-VALIDATE] Sessão 1 indisponível, tentando fallback na Sessão 2...");
    const ctx2 = await getWAContext(2);
    if (!ctx2) return NextResponse.json(r1.json, { status: r1.status });

    const r2 = await proxyVM(ctx2, "/validate", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });

    return NextResponse.json(r2.json, { status: r2.status });

  } catch (e: any) {
    return NextResponse.json(
      { error: e?.name === "AbortError" ? "Timeout ao validar número" : "Falha na comunicação com o servidor do WhatsApp" },
      { status: 500 }
    );
  }
}
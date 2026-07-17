// app/api/whatsapp/validate/route.ts
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

    // Só aceita a resposta da sessão 1 direto se ela confirmou a existência.
    // Se não confirmou — seja por sessão 1 offline, seja porque essa conta
    // especificamente não encontrou o número no onWhatsApp — tenta a sessão 2
    // antes de desistir, já que esse resultado pode variar entre contas.
    if (r1.ok && r1.json?.exists) return NextResponse.json(r1.json, { status: r1.status });

    // Fallback: Sessão 2
    const ctx2 = await getWAContext(2);
    if (!ctx2) return NextResponse.json(r1.json, { status: r1.status });

    const r2 = await proxyVM(ctx2, "/validate", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });

    if (r2.ok && r2.json?.exists) return NextResponse.json(r2.json, { status: r2.status });

    // Nenhuma das duas confirmou — devolve a resposta mais informativa (a que respondeu com sucesso)
    return NextResponse.json(r1.ok ? r1.json : r2.json, { status: r1.ok ? r1.status : r2.status });

  } catch (e: any) {
    return NextResponse.json(
      { error: e?.name === "AbortError" ? "Timeout ao validar número" : "Falha na comunicação com o servidor do WhatsApp" },
      { status: 500 }
    );
  }
}
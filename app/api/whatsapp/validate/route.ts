// app/api/whatsapp/validate/route.ts
import { NextResponse } from "next/server";
import { getWAContext, proxyVM } from "@/lib/whatsapp/wa-context";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx1 = await getWAContext(1);
  if (!ctx1) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { phone } = await req.json().catch(() => ({}));
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  // ✅ 29/08/2026, achado ao investigar por que "número não existe" às vezes
  // era mentira: a VM devolve 503 (sem "exists" nenhum) quando a sessão
  // está desconectada — igual acontece em /send. Todo caller deste endpoint
  // fazia `exists: !!json.exists`, que trata um 503 exatamente igual a um
  // "não encontrei o número de verdade" (exists:false) — mostrando "número
  // inválido" pro admin quando na real ninguém conseguiu checar nada. Só
  // reporta "disconnected" quando NENHUMA das duas sessões conseguiu
  // responder de verdade — se uma respondeu (mesmo dizendo exists:false),
  // esse resultado é confiável e não deve virar "desconectado".
  const DISCONNECTED_RESULT = {
    exists: false,
    disconnected: true,
    error: "Sessão do WhatsApp desconectada — não foi possível verificar o número.",
  };

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

    const r1Disconnected = r1.status === 503;

    // Fallback: Sessão 2
    const ctx2 = await getWAContext(2);
    if (!ctx2) {
      if (r1Disconnected) return NextResponse.json(DISCONNECTED_RESULT, { status: 200 });
      return NextResponse.json(r1.json, { status: r1.status });
    }

    const r2 = await proxyVM(ctx2, "/validate", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });

    if (r2.ok && r2.json?.exists) return NextResponse.json(r2.json, { status: r2.status });

    const r2Disconnected = r2.status === 503;
    if (r1Disconnected && r2Disconnected) {
      return NextResponse.json(DISCONNECTED_RESULT, { status: 200 });
    }

    // Nenhuma das duas confirmou — devolve a resposta mais informativa (a que respondeu com sucesso)
    return NextResponse.json(r1.ok ? r1.json : r2.json, { status: r1.ok ? r1.status : r2.status });

  } catch (e: any) {
    return NextResponse.json(
      { error: e?.name === "AbortError" ? "Timeout ao validar número" : "Falha na comunicação com o servidor do WhatsApp" },
      { status: 500 }
    );
  }
}
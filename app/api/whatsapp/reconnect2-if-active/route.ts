// app/api/whatsapp/reconnect2-if-active/route.ts
import { NextResponse } from "next/server";
import { getWAContextOrCron, proxyVM, errAuth } from "@/lib/whatsapp/wa-context";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await getWAContextOrCron(req, 2);
  if (!ctx) return errAuth();

  try {
    // 1. Checa se a sessão 2 está realmente ativa antes de fazer qualquer coisa
    const statusResult = await proxyVM(ctx, "/status");
    if (!statusResult.ok) {
      return NextResponse.json(
        { error: statusResult.json?.error || "Falha ao checar status" },
        { status: statusResult.status },
      );
    }

    if (!statusResult.json?.connected) {
      // ✅ Sem sessão ativa — não reconecta, evita gerar QR à toa
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "Sessão 2 sem conexão ativa, reconnect ignorado",
      });
    }

    // 2. Só chega aqui se estava conectada — faz a manutenção normal
    const { ok, status, json } = await proxyVM(ctx, "/reconnect", { method: "POST" });
    if (!ok) return NextResponse.json({ error: json?.error || "Falha" }, { status });

    return NextResponse.json({ success: true, skipped: false, status: "reconnecting" });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.name === "AbortError" ? "Timeout" : e?.message },
      { status: 500 },
    );
  }
}
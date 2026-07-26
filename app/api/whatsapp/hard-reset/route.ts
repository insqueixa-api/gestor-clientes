// app/api/whatsapp/hard-reset/route.ts
// "Hard Reset" da Manutenção VM (pedido do Márcio, 26/07/2026) — diferente
// de "Reiniciar Serviço"/"Reiniciar VM": apaga as pastas de sessão INTEIRAS
// das 2 sessões (default + session2) na VM, sem preservar nada, e reinicia
// o processo. Não reconecta sozinho — fica em branco até alguém pedir QR
// novo pela tela do WhatsApp. Usado quando reconectar com QR novo não
// resolveu a entrega (suspeita de sessão/credencial corrompida de um jeito
// que o /disconnect normal, que preserva config, não limpa).
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireUserOrCron, getWAContext } from "@/lib/whatsapp/wa-context";

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

  const [ctx1, ctx2] = await Promise.all([getWAContext(1), getWAContext(2)]);
  if (!ctx1 || !ctx2) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  try {
    const res = await fetch(`${baseUrl}/system/hard-reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKeys: [ctx1.sessionKey, ctx2.sessionKey] }),
    });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao resetar sessões" }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { getWAContext, proxyVM, errAuth } from "@/lib/whatsapp/wa-context";
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getWAContext(2);
  if (!ctx) return errAuth();
  try {
    const { ok, status, json } = await proxyVM(ctx, "/qr");
    if (!ok) return NextResponse.json({ error: json?.error || "Falha" }, { status });
    return NextResponse.json({ qr: json.qr ?? null, connected: !!json.connected, status: json.status ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.name === "AbortError" ? "Timeout" : e?.message }, { status: 500 });
  }
}
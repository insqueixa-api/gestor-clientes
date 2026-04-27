import { NextResponse } from "next/server";
import { getWAContext, proxyVM, errAuth } from "@/lib/whatsapp/wa-context";
export const dynamic = "force-dynamic";

export async function POST() {
  const ctx = await getWAContext(1);
  if (!ctx) return errAuth();
  try {
    const { ok, status, json } = await proxyVM(ctx, "/reconnect", { method: "POST" });
    if (!ok) return NextResponse.json({ error: json?.error || "Falha" }, { status });
    return NextResponse.json({ success: true, status: "reconnecting" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.name === "AbortError" ? "Timeout" : e?.message }, { status: 500 });
  }
}
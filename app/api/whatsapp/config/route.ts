import { NextResponse } from "next/server";
import { getWAContext, proxyVM, errAuth } from "@/lib/whatsapp/wa-context";
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getWAContext(1);
  if (!ctx) return errAuth();
  try {
    const { ok, status, json } = await proxyVM(ctx, "/session-config");
    return NextResponse.json(json, { status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.name === "AbortError" ? "Timeout" : e?.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const ctx = await getWAContext(1);
  if (!ctx) return errAuth();
  const body = await req.json().catch(() => ({}));
  try {
    const { ok, status, json } = await proxyVM(ctx, "/session-config", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(json, { status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.name === "AbortError" ? "Timeout" : e?.message }, { status: 500 });
  }
}
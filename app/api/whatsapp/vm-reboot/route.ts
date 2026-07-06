import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireUserOrCron } from "@/lib/whatsapp/wa-context";

export async function POST(req: Request) {
  const authorized = await requireUserOrCron(req);
  if (!authorized) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const hetznerToken = String(process.env.HETZNER_API_TOKEN || "").trim();
  const serverId = String(process.env.HETZNER_SERVER_ID || "").trim();
  if (!hetznerToken || !serverId) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const res = await fetch(`https://api.hetzner.cloud/v1/servers/${serverId}/actions/reboot`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hetznerToken}`, "Content-Type": "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: json?.error?.message || "Falha ao reiniciar VM" }, { status: res.status });
    }
    return NextResponse.json({ ok: true, action: json?.action });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao reiniciar VM" }, { status: 502 });
  }
}
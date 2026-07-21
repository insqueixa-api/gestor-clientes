// app/api/epg/sync-catalog/fast/download-to-r2/route.ts
// Passo 1 do sync do Fast: pede pra VM baixar o M3U (IP dela não é bloqueado
// pelo painel) e subir cru pro R2. Ponte fina — busca o m3u_url do cliente
// Fast e repassa pra VM, mesmo padrão de app/api/whatsapp/restart-service.
// Passo 2 (processar) é a rota irmã: app/api/epg/sync-catalog/fast (POST).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_ID = "aefcff7a-9b8f-46be-9a1b-155a73a472de";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const isCron = authHeader === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`;

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: cliente, error: clienteErr } = await supabaseAdmin
    .from("clients")
    .select("m3u_url")
    .eq("id", CLIENT_ID)
    .single();

  if (clienteErr || !cliente?.m3u_url) {
    return NextResponse.json(
      { error: `m3u_url do cliente Fast não encontrado: ${clienteErr?.message}` },
      { status: 500 }
    );
  }

  const waBaseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  if (!waBaseUrl || !waToken) {
    return NextResponse.json({ error: "Server misconfigured (VM)." }, { status: 500 });
  }

  try {
    const vmRes = await fetch(`${waBaseUrl}/fast-sync/download-to-r2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${waToken}`,
      },
      body: JSON.stringify({ m3uUrl: cliente.m3u_url }),
      signal: AbortSignal.timeout(60_000),
    });
    const vmJson = await vmRes.json().catch(() => ({}));
    return NextResponse.json(vmJson, { status: vmRes.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Falha ao acionar download na VM." },
      { status: 502 }
    );
  }
}

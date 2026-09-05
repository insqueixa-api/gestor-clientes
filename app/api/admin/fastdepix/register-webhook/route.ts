// app/api/admin/fastdepix/register-webhook/route.ts
// ✅ 04/09/2026, pedido do Márcio: o webhook secret da FastDePix não vem
// junto da chave API na hora da criação (é um cadastro separado, POST
// /webhooks/register, feito só uma vez por chave) — "não tenho acesso a
// isso, seria legal o sistema já cadastrar sozinho". Rota server-side
// (nunca do browser: evita depender de CORS da FastDePix e mantém a
// chamada num só lugar) chamada pelo GatewayModal ao salvar um gateway
// fastpay/fastflow/depix pela primeira vez (ou quando a Chave API muda).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FASTDEPIX_EVENTS = ["transaction.approved", "transaction.paid", "transaction.expired", "transaction.refunded"];

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const apiKey = String(body?.api_key || "").trim();
  if (!apiKey) return NextResponse.json({ error: "api_key é obrigatório" }, { status: 400 });

  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
  if (!appUrl) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  const webhookUrl = `${appUrl.replace(/\/+$/, "")}/api/webhooks/fastdepix`;

  try {
    const res = await fetch("https://fastdepix.space/api/v1/webhooks/register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // ✅ A API deles filtra por User-Agent em alguns endpoints (achado
        // 04/09/2026: GET /webhooks devolve 403 do Apache sem isso) —
        // manda sempre, por precaução, mesmo em endpoints que já
        // funcionaram sem.
        "User-Agent": "Mozilla/5.0 (compatible; UniGestor/1.0)",
      },
      body: JSON.stringify({ url: webhookUrl, events: FASTDEPIX_EVENTS }),
    });
    const json = await res.json().catch(() => ({} as any));

    if (!res.ok || !json?.success || !json?.data?.secret_key) {
      return NextResponse.json(
        { error: json?.message || `Falha ao registrar webhook (HTTP ${res.status})` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      webhook_secret: String(json.data.secret_key),
      webhook_id: json.data.id,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao consultar a FastDePix" }, { status: 502 });
  }
}

// app/api/admin/fastdepix/register-webhook/route.ts
// ✅ 04/09/2026, pedido do Márcio: o webhook secret da FastDePix não vem
// junto da chave API na hora da criação (é um cadastro separado, POST
// /webhooks/register) — "não tenho acesso a isso, seria legal o sistema
// já cadastrar sozinho". Rota server-side (nunca do browser: evita
// depender de CORS da FastDePix e mantém a chamada num só lugar) chamada
// pelo GatewayModal ao salvar um gateway fastpay/fastflow/depix.
//
// ✅ Achado ao vivo (04/09/2026): o webhook é registrado por CONTA/URL, não
// por chave — registrar de novo com uma chave diferente (ex: revogou a
// antiga e gerou outra) devolve 400 "Webhook já registrado para esta URL".
// E o endpoint de LISTAGEM (GET /webhooks) está quebrado no servidor deles
// (403 do Apache, bug do lado deles, não da chave/autenticação — só o
// endpoint de DETALHE por id funciona: GET /webhooks/{id}). Como é conta
// única (sistema single-tenant), a solução é: registrar uma vez, cachear
// id+secret em system_config, e nunca mais depender da API deles pra isso
// — se um dia a chave mudar de novo, o cache já resolve sem precisar
// registrar nem consultar nada.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const FASTDEPIX_EVENTS = ["transaction.approved", "transaction.paid", "transaction.expired", "transaction.refunded"];
const CONFIG_KEY = "fastdepix_webhook";

// ✅ Bootstrap: id do webhook já registrado manualmente em 04/09/2026,
// antes do cache em system_config existir — único jeito de recuperar o
// secret_key sem a listagem (quebrada). Só é usado se o cache estiver
// vazio E uma tentativa de registro nova bater em "já registrado".
const KNOWN_WEBHOOK_ID_FALLBACK = 858;

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getCachedWebhook(): Promise<{ id: number; secret: string } | null> {
  const { data } = await supabaseAdmin
    .from("system_config").select("config_value").eq("config_key", CONFIG_KEY).maybeSingle<{ config_value: string | null }>();
  if (!data?.config_value) return null;
  try {
    const parsed = JSON.parse(data.config_value);
    if (parsed?.id && parsed?.secret) return { id: parsed.id, secret: parsed.secret };
  } catch {}
  return null;
}

async function cacheWebhook(id: number, secret: string) {
  await supabaseAdmin.from("system_config").upsert(
    { config_key: CONFIG_KEY, config_value: JSON.stringify({ id, secret }), updated_at: new Date().toISOString() },
    { onConflict: "config_key" },
  );
}

async function fetchWebhookDetail(apiKey: string, id: number): Promise<string | null> {
  const res = await fetch(`https://fastdepix.space/api/v1/webhooks/${id}`, {
    headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "Mozilla/5.0 (compatible; UniGestor/1.0)" },
  });
  const json = await res.json().catch(() => ({} as any));
  if (res.ok && json?.success && json?.data?.secret_key) return String(json.data.secret_key);
  return null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const apiKey = String(body?.api_key || "").trim();
  if (!apiKey) return NextResponse.json({ error: "api_key é obrigatório" }, { status: 400 });

  // 1) Cache — evita depender da API deles pra qualquer chamada repetida.
  const cached = await getCachedWebhook();
  if (cached) return NextResponse.json({ ok: true, webhook_secret: cached.secret, webhook_id: cached.id, from_cache: true });

  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
  if (!appUrl) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  const webhookUrl = `${appUrl.replace(/\/+$/, "")}/api/webhooks/fastdepix`;

  try {
    // 2) Tenta registrar de verdade.
    const res = await fetch("https://fastdepix.space/api/v1/webhooks/register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; UniGestor/1.0)",
      },
      body: JSON.stringify({ url: webhookUrl, events: FASTDEPIX_EVENTS }),
    });
    const json = await res.json().catch(() => ({} as any));

    if (res.ok && json?.success && json?.data?.secret_key) {
      await cacheWebhook(Number(json.data.id), String(json.data.secret_key));
      return NextResponse.json({ ok: true, webhook_secret: String(json.data.secret_key), webhook_id: json.data.id });
    }

    // 3) "Já registrado" — recupera via GET /webhooks/{id} (detalhe, o
    // único endpoint deles que funciona pra isso) usando o id conhecido.
    const alreadyRegistered = /j[áa] registrado/i.test(String(json?.message || ""));
    if (alreadyRegistered) {
      const secret = await fetchWebhookDetail(apiKey, KNOWN_WEBHOOK_ID_FALLBACK);
      if (secret) {
        await cacheWebhook(KNOWN_WEBHOOK_ID_FALLBACK, secret);
        return NextResponse.json({ ok: true, webhook_secret: secret, webhook_id: KNOWN_WEBHOOK_ID_FALLBACK, recovered: true });
      }
    }

    return NextResponse.json(
      { error: json?.message || `Falha ao registrar webhook (HTTP ${res.status})` },
      { status: 502 },
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao consultar a FastDePix" }, { status: 502 });
  }
}

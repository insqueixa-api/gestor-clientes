import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NATV_BASE = "https://revenda.pixbot.link";

type NatvOwner = { id: number; username: string; credits: number };
type NatvUser = {
  id: number;
  username: string;
  password: string;
  max_connections: number;
  exp_date: number;
  domain: string;
  asaas_pix: string | null;
  owner: NatvOwner;
};

function jsonError(status: number, msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function isInternal(req: NextRequest) {
  const expected = process.env.INTERNAL_API_SECRET || "";
  const received = req.headers.get("x-internal-secret") || "";

  if (!expected || !received) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function pickOwnerFromList(list: NatvUser[]): NatvOwner | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const o = list[0]?.owner;
  if (!o || typeof o.id !== "number") return null;
  return o;
}

export async function POST(req: NextRequest) {
  try {
    const internal = isInternal(req);

    // ✅ Supabase:
    // - Interno: Service Role (não depende de cookie / RLS)
    // - Não-interno: exige usuário logado (RLS protege)
    const supabase = internal
      ? createSupabaseAdmin(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
      : await createSupabaseServer();

    if (!internal) {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr || !auth?.user?.id) {
        return jsonError(401, "Unauthorized");
      }
    }

    const body = await req.json().catch(() => ({}));
    const integration_id = String(body?.integration_id ?? "").trim();

    if (!integration_id) {
      return jsonError(400, "integration_id é obrigatório.");
    }

    // ✅ Token:
    // - Interno: lê direto (service role)
    // - Não-interno: usa RPC segura (mantém seu padrão)
    let token: string | null = null;

    if (internal) {
      const { data: integ, error: integErr } = await supabase
        .from("server_integrations")
        .select("api_token, provider")
        .eq("id", integration_id)
        .single();

      if (integErr || !integ) {
        console.error("NATV sync: integração não encontrada");
        return jsonError(404, "Integração não encontrada");
      }

      if (integ.provider !== "NATV") {
        return jsonError(400, "Integração não é NATV");
      }

      token = typeof integ.api_token === "string" && integ.api_token.trim() ? integ.api_token : null;
    } else {
      const { data: tkn, error: tokenErr } = await supabase.rpc("get_server_integration_token", {
        p_integration_id: integration_id,
      });

      if (tokenErr) {
        console.error("NATV sync: falha RPC token");
        return jsonError(500, "Falha ao sincronizar.");
      }

      token = typeof tkn === "string" && tkn.trim() ? tkn : null;

      // (opcional) valida provider sem expor token:
      const { data: integ2, error: integ2Err } = await supabase
        .from("server_integrations")
        .select("provider")
        .eq("id", integration_id)
        .single();

      if (integ2Err || !integ2) {
        console.error("NATV sync: integração não encontrada (provider)");
        return jsonError(404, "Integração não encontrada");
      }
      if (integ2.provider !== "NATV") {
        return jsonError(400, "Integração não é NATV");
      }
    }

    if (!token) {
      console.error("NATV sync: token ausente");
      return jsonError(404, "Token não encontrado.");
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // 1) teste rápido
    const testRes = await fetch(`${NATV_BASE}/test`, { method: "GET", headers });
    if (!testRes.ok) {
      console.error("NATV sync: /test falhou", testRes.status);
      return jsonError(502, "Falha ao validar token no servidor.");
    }

    // 2) busca owner/credits via /user/search (sem username => lista do revendedor)
    const searchRes = await fetch(`${NATV_BASE}/user/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    if (!searchRes.ok) {
      console.error("NATV sync: /user/search falhou", searchRes.status);
      return jsonError(502, "Falha ao sincronizar saldo no servidor.");
    }

    const list = (await searchRes.json().catch(() => [])) as NatvUser[];
    const owner = pickOwnerFromList(list);

    const patch: any = {
      credits_last_sync_at: new Date().toISOString(),
    };

    if (owner) {
      patch.owner_id = owner.id;
      patch.owner_username = owner.username;
      patch.credits_last_known = owner.credits;
    }

    // atualiza integração
    const { error: upErr } = await supabase
      .from("server_integrations")
      .update(patch)
      .eq("id", integration_id);

    if (upErr) {
      console.error("NATV sync: falha update server_integrations");
      return jsonError(500, "Falha ao salvar sincronização.");
    }

    return NextResponse.json({
      ok: true,
      owner: owner
        ? { id: owner.id, username: owner.username, credits: owner.credits }
        : null,
      message: owner
        ? "Token validado e saldo sincronizado."
        : "Token validado. Não encontrei usuários para inferir owner/saldo ainda.",
    });
  } catch {
    console.error("NATV sync: crash");
    return jsonError(500, "Erro interno");
  }
}

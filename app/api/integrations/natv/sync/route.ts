import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

function pickOwnerFromList(list: NatvUser[]): NatvOwner | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const o = list[0]?.owner;
  if (!o || typeof o.id !== "number") return null;
  return o;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    // valida sessão
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) {
      return NextResponse.json({ ok: false, error: "Não autenticado." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const integration_id = String(body?.integration_id ?? "").trim();

    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id é obrigatório." }, { status: 400 });
    }

    // pega token via função segura (sem expor no browser)
    const { data: token, error: tokenErr } = await supabase.rpc(
      "get_server_integration_token",
      { p_integration_id: integration_id }
    );

    if (tokenErr) throw tokenErr;
    if (!token) throw new Error("Token não encontrado.");

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // 1) teste rápido
    const testRes = await fetch(`${NATV_BASE}/test`, { method: "GET", headers });
    if (!testRes.ok) {
      const t = await testRes.text().catch(() => "");
      throw new Error(`Falha no /test (${testRes.status}). ${t || ""}`.trim());
    }

    // 2) busca owner/credits via /user/search (sem username => retorna lista do revendedor)
    const searchRes = await fetch(`${NATV_BASE}/user/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    if (!searchRes.ok) {
      const t = await searchRes.text().catch(() => "");
      throw new Error(`Falha no /user/search (${searchRes.status}). ${t || ""}`.trim());
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

    // atualiza integração (RLS garante tenant)
    const { error: upErr } = await supabase
      .from("server_integrations")
      .update(patch)
      .eq("id", integration_id);

    if (upErr) throw upErr;

    return NextResponse.json({
      ok: true,
      owner: owner ?? null,
      message: owner
        ? "Token validado e saldo sincronizado."
        : "Token validado. Não encontrei usuários para inferir owner/saldo ainda.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Erro ao sincronizar." },
      { status: 500 }
    );
  }
}

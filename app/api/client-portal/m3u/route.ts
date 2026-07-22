// app/api/client-portal/m3u/route.ts
// Bloco 3 do portal — Gerar / Remover o link M3U da conta. "Gerar" replica
// buildM3uUrlSilent (novo_cliente.tsx): domínio aleatório de servers.dns +
// usuário/senha do próprio cliente. "Remover" é capacidade nova — o admin
// hoje só limpa o campo digitando manualmente.
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { buildM3uUrlFromDns } from "@/lib/apps/panel";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const action = normalizeStr(body?.action);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);

    if (action === "remove") {
      const { error } = await supabaseAdmin.from("clients").update({ m3u_url: null }).eq("id", client_id);
      if (error) return jsonError("Erro interno", 500);
      return NextResponse.json({ ok: true, data: { m3u_url: null } }, { status: 200, headers: NO_STORE_HEADERS });
    }

    if (action === "generate") {
      const { data: client, error: clientErr } = await supabaseAdmin
        .from("clients")
        .select("server_username, server_password, server_id")
        .eq("id", client_id)
        .single();
      if (clientErr || !client) return jsonError("Cliente não encontrado", 404);

      const { data: server } = client.server_id
        ? await supabaseAdmin.from("servers").select("dns").eq("id", client.server_id).maybeSingle()
        : { data: null };

      const m3uUrl = buildM3uUrlFromDns(
        Array.isArray(server?.dns) ? server.dns : [],
        client.server_username,
        client.server_password || "",
      );
      if (!m3uUrl) {
        return jsonError("Não foi possível gerar o link — servidor sem DNS cadastrado.", 400);
      }

      const { error: updErr } = await supabaseAdmin.from("clients").update({ m3u_url: m3uUrl }).eq("id", client_id);
      if (updErr) return jsonError("Erro interno", 500);

      return NextResponse.json({ ok: true, data: { m3u_url: m3uUrl } }, { status: 200, headers: NO_STORE_HEADERS });
    }

    return jsonError("action inválida. Use: generate | remove", 400);
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

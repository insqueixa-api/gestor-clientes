// app/api/integrations/apps/duplextv/route.ts
//
// Duplex TV (duplex24.com, oficialmente mactvplayer.com — mesma marca,
// domínio alternativo). Diferente de toda a família IBO/Messi/BOB/IPTVDUPLEX:
// site antigo (Express + jQuery + Vue), SEM device_key/PIN — só MAC + nome
// + URL.
//
//   - POST /savePlaylists (form-urlencoded) cria — aceita várias playlists
//     de uma vez (names[]/urls[]), mas aqui só mandamos uma por vez.
//   - POST /deletePlaylists apaga TODAS as playlists desse mac de uma vez —
//     não existe delete de uma playlist específica nem listagem (a página
//     /mylist nunca mostra o que já existe, só permite mandar mais).
//   - recaptcha_token (reCAPTCHA v3) está no form mas NÃO é validado no
//     servidor — confirmado ao vivo mandando o campo vazio e funcionando
//     normal. Não precisa resolver captcha nenhum.
//   - Resposta não é JSON: é um redirect 302 pra /mylist, com a mensagem de
//     sucesso/erro guardada em texto claro (base64, sem criptografia real)
//     dentro do cookie de sessão Express (`flash.success`/`flash.error`).
//
// CHECK: não existe endpoint de status pro mac já ativado — /checkMacValid
// (na página /activation, POST {mac_address}) é só pra saber se um mac está
// LIVRE pra comprar ativação nova; num mac já ativado (nosso caso sempre)
// ele só devolve {status:"error", msg:"Sorry, you already activated"}, sem
// data nenhuma. Por isso o "check" quase sempre vai devolver expireDate:null
// — o admin decidiu de propósito manter o vencimento já cadastrado no banco
// nesse caso (não apaga/zera nada) e mostra um aviso pra conferir manualmente
// no painel do IBOSOL (mensagem só no lado do admin — novo_cliente.tsx —,
// não nessa rota, pra não vazar esse detalhe interno pro portal do cliente).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function getSetCookies(headers: Headers): string[] {
  return typeof (headers as any).getSetCookie === "function"
    ? (headers as any).getSetCookie()
    : (headers.get("set-cookie") || "").split(/,(?=[^ ])/).filter(Boolean);
}

function decodeFlash(headers: Headers): { success?: string[]; error?: string[] } {
  const sessCookie = getSetCookies(headers).find((c) => c.trim().startsWith("express:sess="));
  if (!sessCookie) return {};
  const value = sessCookie.split(";")[0].split("=")[1];
  try {
    const json = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return json?.flash || {};
  } catch {
    return {};
  }
}

async function createPlaylist(siteRoot: string, mac: string, name: string, url: string) {
  const res = await fetch(`${siteRoot}/savePlaylists`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({ recaptcha_token: "", mac_address: mac, "names[]": name, "urls[]": url }).toString(),
    redirect: "manual",
  });
  const flash = decodeFlash(res.headers);
  if (flash.error?.length) throw new Error(flash.error[0]);
  if (!flash.success?.length) {
    throw new Error(`Falha ao criar playlist no Duplex TV (status ${res.status}).`);
  }
}

async function deleteAllPlaylists(siteRoot: string, mac: string) {
  const res = await fetch(`${siteRoot}/deletePlaylists`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({ recaptcha_token: "", delete_mac_address: mac }).toString(),
    redirect: "manual",
  });
  const flash = decodeFlash(res.headers);
  if (flash.error?.length) {
    throw Object.assign(new Error(flash.error[0]), { notFound: /does not exist/i.test(flash.error[0]) });
  }
  if (!flash.success?.length) {
    throw new Error(`Falha ao remover playlists no Duplex TV (status ${res.status}).`);
  }
}

// Tenta achar uma data (YYYY-MM-DD ou DD/MM/YYYY) dentro da mensagem do
// /checkMacValid — na prática quase nunca vem (ver nota no topo do
// arquivo), mas cobre o caso de o parceiro mudar a mensagem no futuro.
function extractDateFromMessage(msg: string): string | null {
  const iso = msg.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const br = msg.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

async function checkMac(siteRoot: string, mac: string): Promise<{ expireDate: string | null }> {
  const res = await fetch(`${siteRoot}/checkMacValid`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": UA },
    body: new URLSearchParams({ mac_address: mac }).toString(),
  });
  const json = await res.json().catch(() => null);
  const msg = String(json?.msg || "");
  return { expireDate: extractDateFromMessage(msg) };
}

export async function POST(req: Request) {
  try {
    if (hasBadInternalHeader(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const internal = isInternalRequest(req);

    let supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdmin>;
    if (internal) {
      supabase = createAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
    } else {
      supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, macValue, finalServerName, m3uUrl } = body;

    if (!action) {
      return NextResponse.json({ ok: false, error: "action é obrigatório." }, { status: 400 });
    }
    if (!macValue) {
      return NextResponse.json({ ok: false, error: "macValue é obrigatório." }, { status: 400 });
    }

    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("api_url")
      .eq("app_name", "DUPLEXTV")
      .maybeSingle();

    if (integErr || !integ?.api_url) {
      return NextResponse.json({ ok: false, error: "Integração Duplex TV não configurada." }, { status: 500 });
    }
    const siteRoot = new URL(integ.api_url).origin;

    // ===========================================================
    // ACTION: check — não existe vencimento real disponível (ver nota no
    // topo). Quando não vier nada, devolve expireDate:null e uma mensagem
    // genérica — o admin decide o que fazer (manter o valor do banco).
    // ===========================================================
    if (action === "check") {
      const { expireDate } = await checkMac(siteRoot, macValue);
      return NextResponse.json({
        ok: true,
        expireDate,
        message: expireDate
          ? "Vencimento atualizado."
          : "Não foi possível localizar o vencimento automaticamente.",
      });
    }

    // ===========================================================
    // ACTION: create
    // ===========================================================
    if (action === "create") {
      if (!m3uUrl) {
        return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      }
      await createPlaylist(siteRoot, macValue, finalServerName || "Playlist", m3uUrl);

      // Mesma tentativa best-effort do "check" — quase sempre vem null (ver
      // nota no topo do arquivo), mas o caller usa esse `message` pra
      // decidir se mostra o aviso de conferir no painel do IBOSOL.
      const { expireDate } = await checkMac(siteRoot, macValue);
      return NextResponse.json({
        ok: true,
        expireDate,
        message: expireDate
          ? "Playlist configurada com sucesso."
          : "Playlist configurada com sucesso. Não foi possível localizar o vencimento automaticamente.",
      });
    }

    // ===========================================================
    // ACTION: delete — apaga TODAS as playlists desse mac (o parceiro não
    // tem delete seletivo por nome/id).
    // ===========================================================
    if (action === "delete") {
      try {
        await deleteAllPlaylists(siteRoot, macValue);
      } catch (e: any) {
        if (e?.notFound) {
          return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
        }
        throw e;
      }
      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Erro interno." }, { status: 500 });
  }
}

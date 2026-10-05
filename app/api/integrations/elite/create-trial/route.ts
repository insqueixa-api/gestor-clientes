// app/api/integrations/elite/create-trial/route.ts
// ✅ 05/10/2026: teste IPTV/P2P pela API oficial do Elite (POST
// /iptv/trials | /p2p/trials) — substitui ELITE_CREATE_TRIAL da extensão.
// Mesmo contrato das rotas NaTV/Fast (novo_cliente.tsx usa o caminho
// genérico): entra username/password/technology, sai
// { ok, data: { username, password, external_user_id, exp_date } }.
//
// Regras do Elite: P2P exige usuário e senha com EXATAMENTE 12 letras/números;
// IPTV segue as regras do painel (mandamos só letras/números, mín. 12 como o
// fluxo antigo fazia). Teste não cobra crédito. Teste P2P só ganha vencimento
// no primeiro acesso — aí exp_date volta vazio e o front mantém o horário do
// teste que ele mesmo calculou.
import { NextResponse } from "next/server";
import { randomInt } from "crypto";
import { resolveEliteCaller } from "@/lib/integrations/elite-auth";
import {
  EliteApiError,
  eliteExpiry,
  eliteIdempotencyKey,
  eliteRequest,
  eliteTechOf,
  eliteUnwrap,
  loadEliteIntegration,
} from "@/lib/integrations/elite-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALNUM = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomAlnum(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALNUM[randomInt(ALNUM.length)];
  return s;
}

function digits(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += String(randomInt(10));
  return s;
}

const LETTERS = "abcdefghijkmnpqrstuvwxyz";

/**
 * Regra do Elite (resposta real da API, 05/10/2026): "Login: use 12 a 100
 * caracteres, incluindo letras e números; apenas ponto, hífen e sublinhado
 * são aceitos como símbolos". Mantém o que dá do valor digitado, garante 1
 * letra + 1 número e completa com números até o mínimo.
 */
function shapeCredential(raw: string, min: number, max: number, keepSymbols: boolean) {
  const clean = String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(keepSymbols ? /[^a-zA-Z0-9._-]/g : /[^a-zA-Z0-9]/g, "");
  const ok = (v: string) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v);
  let s = clean.slice(0, max);
  if (!ok(s)) {
    s = clean.slice(0, max - 2);
    if (!/[a-zA-Z]/.test(s)) s += LETTERS[randomInt(LETTERS.length)];
    if (!/[0-9]/.test(s)) s += digits(1);
  }
  if (s.length < min) s += digits(min - s.length);
  return s.slice(0, max);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const integration_id = String(body?.integration_id ?? "").trim();
    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    }
    const caller = await resolveEliteCaller(req, body);
    if (!caller) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const integ = await loadEliteIntegration(integration_id, caller.tenantId);
    const tech = eliteTechOf(body?.technology);

    const userBase = String(body?.username ?? "").trim() || randomAlnum(8);
    const passBase = String(body?.password ?? "").trim() || randomAlnum(12);

    // P2P: exatamente 12 letras/números. IPTV: 12–100, letras+números, só . - _
    // (a senha IPTV digitada é mantida se já cumprir a regra — o exemplo da doc
    // aceita "!" na senha; só ajusta quando é curta ou sem letra/número).
    let username: string;
    let password: string;
    if (tech === "p2p") {
      username = shapeCredential(userBase, 12, 12, false);
      password = shapeCredential(passBase, 12, 12, false);
    } else {
      username = shapeCredential(userBase, 12, 100, true);
      password =
        passBase.length >= 12 && passBase.length <= 100 && /[a-zA-Z]/.test(passBase) && /[0-9]/.test(passBase) && !/s/.test(passBase)
          ? passBase
          : shapeCredential(passBase, 12, 100, true);
    }

    const { data, requestId } = await eliteRequest(integ, "POST", `/${tech}/trials`, {
      body: { username, password, adult: false },
      idempotencyKey: eliteIdempotencyKey(`trial-${tech}`),
    });
    const d = eliteUnwrap(data) || {};
    const clientId = d.client_id ?? d.id ?? d.client?.id ?? null;
    if (clientId === null || clientId === undefined) {
      console.error("[ELITE] teste sem client_id", { requestId, data });
      throw new Error("O Elite não devolveu o ID do teste criado.");
    }

    // Vencimento: tenta da própria resposta; senão 1 leitura do cliente
    // (IPTV). P2P sem ativação não tem vencimento — não adianta consultar.
    let expIso = eliteExpiry(d);
    if (!expIso && tech === "iptv") {
      try {
        const det = await eliteRequest(integ, "GET", `/iptv/clients/${encodeURIComponent(String(clientId))}`);
        expIso = eliteExpiry(det.data);
      } catch (e) {
        console.error("[ELITE] não consegui ler o vencimento do teste", (e as any)?.message);
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        username: String(d.username || username),
        password,
        external_user_id: String(clientId),
        exp_date: expIso ? Math.floor(new Date(expIso).getTime() / 1000) : null,
        m3u_url: "",
      },
    });
  } catch (e: any) {
    const status = e instanceof EliteApiError && e.status >= 400 && e.status < 500 ? e.status : 500;
    console.error("[integration_error:elite:create-trial]", {
      message: e?.message,
      status: e?.status,
      requestId: e?.requestId,
      kind: "integration_error",
      provider: "elite",
      action: "create-trial",
    });
    return NextResponse.json({ ok: false, error: e?.message || "Falha ao criar teste no Elite." }, { status });
  }
}

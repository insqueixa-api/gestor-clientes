import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Aceita: "67", "67,0", "67.0", "1.234,56" e converte para número
function parseLooseNumber(input: string): number | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const m = raw.match(/-?\d[\d.,]*/);
  if (!m) return null;
  let s = m[0];
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  try {
    // Autenticação de Segurança
    const internalSecret = String(req.headers.get("x-internal-secret") || "").trim();
    const expectedSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
    const a = Buffer.from(internalSecret);
    const b = Buffer.from(expectedSecret);
    const isInternal = !!expectedSecret && a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!isInternal) {
      const { createClient } = await import("@/lib/supabase/server");
      const supabaseAuth = await createClient();
      const { data: auth, error: authErr } = await supabaseAuth.auth.getUser();
      if (authErr || !auth?.user?.id) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const { integration_id, action, saldo, loggedUser } = body;

    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    }

    const sb = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // =======================================================================
    // AÇÃO 1: O Frontend pede as credenciais para injetar na Extensão
    // =======================================================================
    if (action === "get_credentials") {
      const { data: integ, error } = await sb
        .from("server_integrations")
        .select("id, api_token, api_secret, api_base_url, provider, is_active")
        .eq("id", integration_id)
        .single();

      if (error || !integ) throw new Error("Integração não encontrada.");
      if (String(integ.provider).toUpperCase() !== "ELITE") throw new Error("A integração não é ELITE.");
      if (!integ.is_active) throw new Error("A integração está inativa.");

      return NextResponse.json({
        ok: true,
        credentials: {
          baseUrl: integ.api_base_url,
          username: integ.api_token,
          password: integ.api_secret
        }
      });
    }

    // =======================================================================
    // AÇÃO 2: O Frontend devolve o Saldo Lido e nós salvamos no Banco
    // =======================================================================
    if (action === "save_sync") {
      const parsedCredits = parseLooseNumber(saldo);
      const patch: any = {
        credits_last_sync_at: new Date().toISOString(),
      };
      
      if (loggedUser) patch.owner_username = loggedUser;
      if (parsedCredits !== null) patch.credits_last_known = parsedCredits;

      await sb.from("server_integrations").update(patch).eq("id", integration_id);

      return NextResponse.json({
        ok: true,
        message: "Saldo do ELITE sincronizado com sucesso via Extensão.",
        saved: { credits_last_known: parsedCredits, owner_username: patch.owner_username }
      });
    }

    return NextResponse.json({ ok: false, error: "Ação não especificada (use get_credentials ou save_sync)." }, { status: 400 });

  } catch (e: any) {
    console.error("[ELITE SYNC ERROR]", e);
    return NextResponse.json({ ok: false, error: e.message || "Falha no sync ELITE." }, { status: 500 });
  }
}
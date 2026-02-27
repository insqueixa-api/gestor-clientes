import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// ✅ Nunca cachear resposta do portal
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const GENERIC_OK = {
  ok: true,
  message: "Se o link estiver válido, enviaremos instruções no WhatsApp.",
};

function normalizeToken(v: unknown) {
  return String(v ?? "").trim();
}

// ✅ reduz brute force/oráculo e evita lixo (não substitui validação no banco)
function isPlausibleToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

// ✅ log “cego”: nada de imprimir token/stack em produção
function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.error(...args);
  }
}

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
if (!supabaseAdmin) {
  safeServerLog("[PORTAL][pin_reset] Server misconfigured");
  return NextResponse.json(GENERIC_OK, { status: 200, headers: NO_STORE_HEADERS });
}


    const body = await req.json().catch(() => ({} as any));
    const token = normalizeToken((body as any)?.token ?? (body as any)?.t);

    // ✅ resposta “cega” (evita enumeração/oráculo)
    if (!token || !isPlausibleToken(token)) {
      return NextResponse.json(GENERIC_OK, { status: 200, headers: NO_STORE_HEADERS });
    }

    // 1. Executa o reset no banco (A RPC deve retornar tenant_id e client_id)
    const { data: resetResult, error } = await supabaseAdmin.rpc("portal_request_pin_reset", { p_token: token });

    if (error) {
      safeServerLog("[PORTAL][pin_reset] rpc error", error.message);
      return NextResponse.json(GENERIC_OK, { status: 200, headers: NO_STORE_HEADERS });
    }

    // 2. DISPARO DE WHATSAPP
    const resData = Array.isArray(resetResult) ? resetResult[0] : resetResult;
    const tid = resData?.tenant_id;
    const cid = resData?.client_id;
    const novoPin = resData?.new_pin; // ✅ 1. Extrai o novo PIN gerado pelo banco

    if (tid && cid && novoPin) { // ✅ 2. Valida se o PIN realmente existe
      try {
        const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
        const internalSecret = String(process.env.INTERNAL_API_SECRET || "").trim();

        // Busca o template "Reset Portal" para pegar o PIN novo gerado
        const { data: tmpl } = await supabaseAdmin
          .from("message_templates")
          .select("content")
          .eq("tenant_id", tid)
          .ilike("name", "%Reset Portal%")
          .maybeSingle();

        if (tmpl?.content) {
          // ✅ 3. Substitui a variável do PIN no template. 
          // Ajuste "{{pin}}" se você cadastrou diferente no Gestor (ex: "{{senha}}")
          const mensagemPronta = tmpl.content.replace(/\{\{pin\}\}/gi, novoPin);

          // Chama a sua API de envio agora
          await fetch(`${appUrl}/api/whatsapp/envio_agora`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json", 
                "x-internal-secret": internalSecret 
            },
            body: JSON.stringify({
              tenant_id: tid,
              recipient_id: cid,
              recipient_type: "client",
              message: mensagemPronta // ✅ 4. Envia a mensagem final já com o PIN embutido
            })
          });
          safeServerLog("[PORTAL][pin_reset] Disparo via WhatsApp solicitado com sucesso. PIN atualizado.");
        }
      } catch (waErr: any) {
        safeServerLog("[PORTAL][pin_reset] Erro ao disparar WhatsApp:", waErr.message);
      }
    }

    return NextResponse.json(GENERIC_OK, { status: 200, headers: NO_STORE_HEADERS });
  } catch (err: any) {
    safeServerLog("[PORTAL][pin_reset] unexpected", err?.message);
    return NextResponse.json(GENERIC_OK, { status: 200, headers: NO_STORE_HEADERS });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import bcrypt from "bcryptjs"; 

export const dynamic = "force-dynamic";

// ✅ Nunca cachear respostas
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

// ✅ Log “cego”
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
  const supabaseAdmin = makeSupabaseAdmin();
  if (!supabaseAdmin) {
    safeServerLog("[RESET_ACCESS] Server misconfigured");
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }

  try {
    const body = await req.json().catch(() => ({} as any));
    const tenant_id = String(body?.tenant_id || "").trim();
    const client_id = String(body?.client_id || "").trim();
    const send_whatsapp = body?.send_whatsapp === true;

    if (!tenant_id || !client_id) {
      return NextResponse.json({ ok: false, error: "Parâmetros incompletos" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // 1) Busca os dados do cliente
    const { data: client, error: cErr } = await supabaseAdmin
      .from("clients")
      .select("whatsapp_username, secondary_whatsapp_username, display_name")
      .eq("id", client_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (cErr || !client) {
        return NextResponse.json({ ok: false, error: "Cliente não encontrado." }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const numbersToReset = [client.whatsapp_username, client.secondary_whatsapp_username].filter(Boolean);

    if (numbersToReset.length === 0) {
        return NextResponse.json({ ok: false, error: "Cliente não possui WhatsApp cadastrado." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // 2) Processa cada número (Principal e Secundário)
    for (const number of numbersToReset) {
      const wNumber = String(number).trim();
      if (!wNumber) continue;

      // Pega os últimos 4 dígitos para a senha
      const newPin = wNumber.slice(-4); 
      // Gera o Hash Bcrypt padrão (salt 6 conforme seu banco)
      const pinHash = await bcrypt.hash(newPin, 6); 

      // Deleta as chaves velhas e sessões ativas
      await supabaseAdmin.from("client_portal_tokens").delete().eq("whatsapp_username", wNumber);
      await supabaseAdmin.from("client_portal_sessions").delete().eq("whatsapp_username", wNumber);

      // Gera o NOVO link (Token Seguro de 48 caracteres hex)
      const newToken = crypto.randomBytes(24).toString("hex");

      // Insere o Novo Token
      await supabaseAdmin.from("client_portal_tokens").insert({
        tenant_id,
        whatsapp_username: wNumber,
        token: newToken,
        label: "Reset manual via painel",
        is_active: true,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // Válido por 1 ano
      });

      // Atualiza ou Insere a Nova Senha na tabela de credenciais
      const { data: hasCred } = await supabaseAdmin
        .from("client_portal_credentials")
        .select("whatsapp_username")
        .eq("whatsapp_username", wNumber)
        .maybeSingle();
      
      if (hasCred) {
        await supabaseAdmin
            .from("client_portal_credentials")
            .update({ pin_hash: pinHash, pin_changed_at: new Date().toISOString() })
            .eq("whatsapp_username", wNumber);
      } else {
        await supabaseAdmin
            .from("client_portal_credentials")
            .insert({ tenant_id, whatsapp_username: wNumber, pin_hash: pinHash });
      }
    }

// 3) Disparo WhatsApp (Caso tenha marcado no botão)
    if (send_whatsapp && client.whatsapp_username) {
        safeServerLog(`[RESET_ACCESS] Disparo de WhatsApp solicitado para: ${client.whatsapp_username}`);
        
        try {
            // 3.1) Busca o Template "Reset Portal" no banco
            const { data: tmpl } = await supabaseAdmin
              .from("message_templates")
              .select("content")
              .eq("tenant_id", tenant_id) // ✅ Corrigido para a variável com underline
              .ilike("name", "%Reset Portal%")
              .order("name", { ascending: true })
              .limit(1)
              .maybeSingle();

            const msgContent = tmpl?.content;

            if (!msgContent) {
                safeServerLog("[RESET_ACCESS] Template 'Reset Portal' não encontrado. Abortando envio WA.");
            } else {
                // 3.2) Dispara a requisição interna para a sua API de envio_agora
                const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
                const internalSecret = String(process.env.INTERNAL_API_SECRET || "").trim();

                const waRes = await fetch(`${appUrl}/api/whatsapp/envio_agora`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-internal-secret": internalSecret,
                    },
                        body: JSON.stringify({
                        tenant_id: tenant_id, // ✅ Corrigido
                        recipient_id: client_id,
                        recipient_type: "client",
                        message: msgContent
                    })
                });

                if (!waRes.ok) {
                    safeServerLog("[RESET_ACCESS] Falha ao enviar requisição para /api/whatsapp/envio_agora", waRes.status);
                } else {
                    safeServerLog("[RESET_ACCESS] WhatsApp disparado com sucesso!");
                }
            }
        } catch (e: any) {
            safeServerLog("[RESET_ACCESS] Erro ao tentar enviar WhatsApp", e?.message);
        }
    }

    return NextResponse.json({ ok: true, message: "Acesso resetado com sucesso." }, { status: 200, headers: NO_STORE_HEADERS });

  } catch (err: any) {
    safeServerLog("[RESET_ACCESS] unexpected error", err?.message);
    return NextResponse.json({ ok: false, error: "Erro interno no servidor" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
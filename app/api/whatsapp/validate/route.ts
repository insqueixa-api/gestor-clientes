import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function makeSessionKey(tenantId: string, userId: string) {
  return crypto.createHash("sha256").update(`${tenantId}:${userId}`).digest("hex");
}

// ✅ NOVO: Função para gerar a chave da Sessão 2
function makeSessionKey2(tenantId: string, userId: string) {
  return crypto.createHash("sha256").update(`${tenantId}:${userId}:2`).digest("hex");
}

async function getSessionHeaders() {
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL;
  const token = process.env.UNIGESTOR_WA_TOKEN;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: member } = await supabase
    .from("tenant_members").select("tenant_id").eq("user_id", user.id).maybeSingle();
  if (!member?.tenant_id) return null;
  
  const sessionKey1 = makeSessionKey(member.tenant_id, user.id);
  const sessionKey2 = makeSessionKey2(member.tenant_id, user.id); // ✅ Chave 2 gerada

  return {
    baseUrl, 
    token,
    sessionKey1,
    sessionKey2
  };
}

export async function POST(req: Request) {
  const ctx = await getSessionHeaders();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { phone } = await req.json().catch(() => ({}));
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  try {
    // ✅ TENTATIVA 1: Bate na Sessão 1
    let res = await fetch(`${ctx.baseUrl}/validate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        "x-session-key": ctx.sessionKey1,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone }),
    });

    // ✅ FALLBACK: Se a Sessão 1 falhar (ex: status 503 "Sessão não conectada"), tenta a Sessão 2
    if (!res.ok) {
      console.log("[WA-VALIDATE] Sessão 1 indisponível, tentando fallback na Sessão 2...");
      res = await fetch(`${ctx.baseUrl}/validate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          "x-session-key": ctx.sessionKey2, // Passa a chave 2 aqui!
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone }),
      });
    }

    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });

  } catch (error) {
    // ✅ Segurança caso a VM inteira caia
    return NextResponse.json({ error: "Falha na comunicação com o servidor do WhatsApp" }, { status: 500 });
  }
}
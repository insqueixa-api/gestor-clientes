import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Puxa as configurações que você já tem cadastradas na Vercel
const baseUrl = process.env.UNIGESTOR_WA_BASE_URL; 
const token = process.env.UNIGESTOR_WA_TOKEN;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const { phone } = await request.json();

    if (!baseUrl || !token) {
      return NextResponse.json({ error: "Configuração de WhatsApp ausente" }, { status: 500 });
    }

    // 1. Busca o cliente e o PIN no banco
    const { data: client, error } = await supabase
      .from("clients")
      .select("access_pin, whatsapp, name")
      .eq("whatsapp", phone)
      .single();

    if (error || !client) {
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
    }

    const pinToSend = client.access_pin || client.whatsapp.slice(-4);

    // 2. Dispara o PIN usando a mesma estrutura do seu arquivo de status
    const vmResponse = await fetch(`${baseUrl}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        phone: client.whatsapp,
        message: `*UniGestor*\n\nOlá ${client.name || ''}, seu PIN de acesso é: *${pinToSend}*\n\nAcesse: https://unigestor.net.br`,
      }),
    });

    if (!vmResponse.ok) throw new Error("VM recusou o envio");

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Falha ao enviar PIN" }, { status: 500 });
  }
}
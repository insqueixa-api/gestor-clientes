import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  
  if (!clientId) {
    return NextResponse.json(
      { error: "Configuração ausente", details: "GOOGLE_CLIENT_ID não foi definido no ambiente." },
      { status: 500 }
    );
  }

  // Descobre automaticamente se você está rodando no localhost ou na Vercel
  const { origin } = new URL(req.url);
  const redirectUri = `${origin}/api/auth/google/callback`;

  // Escopo total: permite LER, CRIAR e EDITAR contatos e labels direto no seu celular
  const scopes = [
    "https://www.googleapis.com/auth/contacts"
  ].join(" ");

  // Monta a URL oficial de login do Google
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` + 
    `&prompt=consent`;

  // Redireciona o usuário para a tela de login do Google
  return NextResponse.redirect(googleAuthUrl);
}
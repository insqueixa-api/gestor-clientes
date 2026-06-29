// app/api/epg/sync/imagem/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[\d]+$/.test(id) || id.length > 20) {
    return new NextResponse("Invalid ID", { status: 400 });
  }
  
  // Mantemos o ID exatamente como vem, com os zeros
  const url = `https://getcdn.nowonline.com.br/images_epg/360_540/${id}.jpg`;

  try {
    const resp = await fetch(url, {
      headers: { 
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        // User-Agent completo de um navegador Chrome no Windows
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        // Algumas CDNs preferem sem Referer, outras exigem. Vamos tentar o padrão da raiz da Claro.
        "Referer": "https://www.claro.com.br/" 
      },
      signal: AbortSignal.timeout(8000), // Aumentei um pouco o timeout
    });
    
    if (!resp.ok) {
       console.error(`Erro ao buscar imagem na Claro. Status: ${resp.status}`);
       return new NextResponse("Erro CDN", { status: resp.status });
    }

    const buffer = await resp.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": resp.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error("Erro no proxy de imagem:", error);
    return new NextResponse("Gateway Timeout", { status: 502 });
  }
}
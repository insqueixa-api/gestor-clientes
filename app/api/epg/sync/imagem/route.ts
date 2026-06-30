// app/api/epg/sync/imagem/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// A Claro distribui as imagens entre dois CDNs distintos.
// Tentamos o primeiro e caímos para o segundo se não encontrar.
const HOSTS = [
  "https://getcdn.nowonline.com.br/images_epg/360_540",
  "https://ds2.cds.nowonline.com.br/images_epg/360_540",
];

const FETCH_HEADERS = {
  "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://www.claro.com.br/",
};

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[\d]+$/.test(id) || id.length > 20) {
    return new NextResponse("Invalid ID", { status: 400 });
  }

  for (const host of HOSTS) {
    const url = `${host}/${id}.jpg`;
    try {
      const resp = await fetch(url, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(6000),
      });

      if (resp.ok) {
        const buffer = await resp.arrayBuffer();
        return new NextResponse(buffer, {
          headers: {
            "Content-Type": resp.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      console.warn(`[EPG-IMG] ${host} retornou ${resp.status} para id=${id}`);
    } catch (error: any) {
      console.warn(`[EPG-IMG] Falha em ${host} para id=${id}:`, error.message);
    }
  }

  return new NextResponse("Imagem não encontrada em nenhum CDN", { status: 404 });
}
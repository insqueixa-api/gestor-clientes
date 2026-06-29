// app/api/epg/sync/imagem/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[\d]+$/.test(id) || id.length > 20) {
    return new NextResponse("Invalid", { status: 400 });
  }
  const url = `https://getcdn.nowonline.com.br/images_epg/360_540/${id}.jpg`;

  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://programacao.claro.com.br/" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return new NextResponse(null, { status: resp.status });

    const buffer = await resp.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
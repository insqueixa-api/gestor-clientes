import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const M3U_URL = "http://p1fast.com/get.php?username=AndersonFastTV31&password=4186520479&type=m3u_plus&output=ts";

  try {
    // Tentativa de simulação perfeita de um navegador Google Chrome para burlar o firewall
    const response = await fetch(M3U_URL, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
      } 
    });

    if (!response.ok) {
      throw new Error(`Falha ao baixar M3U Fast: HTTP ${response.status}`);
    }

    const m3uText = await response.text();
    const lines = m3uText.split(/\r?\n/);
    const vods = [];
    let currentVOD: any = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("#EXTINF:")) {
        const tvgId = trimmed.match(/tvg-id="([^"]*)"/)?.[1] || "";
        
        // FILTRO INVERTIDO: Se TEM tvg-id, é TV ao vivo. Pulamos!
        // Queremos apenas o que NÃO tem tvg-id (Filmes e Séries)
        if (tvgId !== "") {
          currentVOD = null;
          continue;
        }

        const logo = trimmed.match(/tvg-logo="([^"]*)"/)?.[1] || "";
        const group = trimmed.match(/group-title="([^"]*)"/)?.[1] || "Outros";
        
        // O título fica após a última vírgula na linha EXTINF
        const title = trimmed.split(",").pop()?.trim() || "Desconhecido";

        currentVOD = {
          title,
          logo,
          group,
          servidor: "FAST"
        };
      } else if (!trimmed.startsWith("#")) {
        // Salva a URL apenas se passou pelo filtro de VOD
        if (currentVOD && currentVOD.title) {
          currentVOD.url = trimmed;
          vods.push(currentVOD);
          currentVOD = null; // Reseta
        }
      }
    }

    return NextResponse.json({
      ok: true,
      total_vods: vods.length,
      amostra: vods.slice(0, 20)
    });

  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
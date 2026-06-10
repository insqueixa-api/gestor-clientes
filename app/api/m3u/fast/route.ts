import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const M3U_URL = "http://p1fast.com/get.php?username=Insqueixa&password=uC8369&type=m3u_plus&output=ts";

  try {
    // A chave mestra para evitar o Erro 403 em servidores IPTV
    const response = await fetch(M3U_URL, {
      headers: { 
        "User-Agent": "IPTVSmartersPro",
        "Accept": "*/*"
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
        
        // Em listas de VOD, o nome do filme fica no final da string EXTINF
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

    // Para não travar o seu navegador no teste, retornamos o total e apenas os 20 primeiros filmes
    return NextResponse.json({
      ok: true,
      total_vods: vods.length,
      amostra: vods.slice(0, 20)
    });

  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
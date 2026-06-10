import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const M3U_URL = "http://rj98.eu/get.php?username=Insqueixa&password=62206935744&type=m3u_plus&output=ts";

  try {
    const response = await fetch(M3U_URL, {
      headers: { 
        "User-Agent": "IPTVSmartersPro",
        "Accept": "*/*"
      } 
    });

    if (!response.ok) {
      throw new Error(`Falha ao baixar M3U NaTV: HTTP ${response.status}`);
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
        
        // FILTRO INVERTIDO: Ignora TV ao vivo (que possui tvg-id)
        if (tvgId !== "") {
          currentVOD = null;
          continue;
        }

        const logo = trimmed.match(/tvg-logo="([^"]*)"/)?.[1] || "";
        const group = trimmed.match(/group-title="([^"]*)"/)?.[1] || "Outros";
        const title = trimmed.split(",").pop()?.trim() || "Desconhecido";

        currentVOD = {
          title,
          logo,
          group,
          servidor: "NATV"
        };
      } else if (!trimmed.startsWith("#")) {
        if (currentVOD && currentVOD.title) {
          currentVOD.url = trimmed;
          vods.push(currentVOD);
          currentVOD = null; 
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
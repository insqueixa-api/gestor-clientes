import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  // A MÁGICA: Trocamos get.php por player_api.php com a ação get_vod_streams
  const API_URL = "http://p1fast.com/player_api.php?username=Insqueixa&password=uC8369&action=get_vod_streams";

  try {
    const response = await fetch(API_URL, {
      headers: { "User-Agent": "IPTVSmartersPro" } 
    });

    if (!response.ok) {
      throw new Error(`Falha na API Fast: HTTP ${response.status}`);
    }

    // O servidor já devolve um JSON puro, muito mais leve e rápido de processar!
    const data = await response.json();

    // Mapeamos o retorno deles para o formato que você quer
    const vods = data.map((vod: any) => ({
      title: vod.name,
      logo: vod.stream_icon || "",
      categoria_id: vod.category_id,
      stream_id: vod.stream_id,
      extensao: vod.container_extension,
      // A URL de stream de VOD no Xtream Codes é montada assim:
      url: `http://p1fast.com/movie/Insqueixa/uC8369/${vod.stream_id}.${vod.container_extension}`,
      servidor: "FAST"
    }));

    return NextResponse.json({
      ok: true,
      total_vods: vods.length,
      amostra: vods.slice(0, 20)
    });

  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
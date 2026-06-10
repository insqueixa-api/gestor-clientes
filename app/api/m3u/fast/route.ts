import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type M3uChannel = {
  id: string;
  name: string;
  logo: string;
  group: string;
  title: string;
  url: string;
};

export async function GET() {
  // URL atualizada para o servidor Fast
  const M3U_URL = "http://psbox.top/get.php?username=Insqueixa&password=uC8369&type=m3u_plus&output=ts";

  try {
    const response = await fetch(M3U_URL, {
      headers: { "User-Agent": "VLC/3.0.18 LibVLC/3.0.18" } 
    });

    if (!response.ok) {
      throw new Error(`Falha ao baixar M3U Fast: HTTP ${response.status}`);
    }

    const m3uText = await response.text();
    const lines = m3uText.split(/\r?\n/);
    const channels: M3uChannel[] = [];
    let currentChannel: Partial<M3uChannel> = {};

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) continue;

      if (trimmed.startsWith("#EXTINF:")) {
        const tvgId = trimmed.match(/tvg-id="([^"]*)"/)?.[1] || "";
        const tvgName = trimmed.match(/tvg-name="([^"]*)"/)?.[1] || "";
        const tvgLogo = trimmed.match(/tvg-logo="([^"]*)"/)?.[1] || "";
        const groupTitle = trimmed.match(/group-title="([^"]*)"/)?.[1] || "Outros";
        
        const title = trimmed.split(",").pop()?.trim() || "Canal Desconhecido";

        currentChannel = {
          id: tvgId,
          name: tvgName,
          logo: tvgLogo,
          group: groupTitle,
          title: title,
        };
      } else if (!trimmed.startsWith("#")) {
        if (currentChannel.title) {
          currentChannel.url = trimmed;
          channels.push(currentChannel as M3uChannel);
          currentChannel = {}; 
        }
      }
    }

    return NextResponse.json({
      ok: true,
      total_canais: channels.length,
      canais: channels
    });

  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
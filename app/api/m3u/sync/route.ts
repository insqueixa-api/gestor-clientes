import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // M3U pode ser grande, melhor dar margem

type M3uChannel = {
  id: string;
  name: string;
  logo: string;
  group: string;
  title: string;
  url: string;
};

export async function GET() {
  const M3U_URL = "http://rj98.eu/get.php?username=Insqueixa&password=62206935744&type=m3u_plus&output=ts";

  try {
    // 1. Baixa o conteúdo do arquivo M3U
    const response = await fetch(M3U_URL, {
      // Alguns servidores IPTV bloqueiam requisições sem User-Agent válido
      headers: { "User-Agent": "VLC/3.0.18 LibVLC/3.0.18" } 
    });

    if (!response.ok) {
      throw new Error(`Falha ao baixar M3U: HTTP ${response.status}`);
    }

    const m3uText = await response.text();

    // 2. Faz o parse linha por linha
    const lines = m3uText.split(/\r?\n/);
    const channels: M3uChannel[] = [];
    let currentChannel: Partial<M3uChannel> = {};

    for (const line of lines) {
      const trimmed = line.trim();

      // Ignora linhas vazias
      if (!trimmed) continue;

      if (trimmed.startsWith("#EXTINF:")) {
        // Extrai as tags usando Regex
        const tvgId = trimmed.match(/tvg-id="([^"]*)"/)?.[1] || "";
        const tvgName = trimmed.match(/tvg-name="([^"]*)"/)?.[1] || "";
        const tvgLogo = trimmed.match(/tvg-logo="([^"]*)"/)?.[1] || "";
        const groupTitle = trimmed.match(/group-title="([^"]*)"/)?.[1] || "Outros";
        
        // O título de exibição geralmente fica após a última vírgula na linha EXTINF
        const title = trimmed.split(",").pop()?.trim() || "Canal Desconhecido";

        currentChannel = {
          id: tvgId,
          name: tvgName,
          logo: tvgLogo,
          group: groupTitle,
          title: title,
        };
      } else if (!trimmed.startsWith("#")) {
        // Se não começa com # e não é vazia, é a URL de streaming (terminando em .ts ou .m3u8)
        if (currentChannel.title) {
          currentChannel.url = trimmed;
          channels.push(currentChannel as M3uChannel);
          currentChannel = {}; // Reseta para o próximo canal
        }
      }
    }

    // 3. Retorna os dados normalizados
    return NextResponse.json({
      ok: true,
      total_canais: channels.length,
      canais: channels
    });

  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
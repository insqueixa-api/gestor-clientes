// src/lib/api/flaresolverr.ts

export async function fetchViaFlareSolverr(
    targetUrl: string,
    method: "GET" | "POST" = "GET",
    postData?: string
) {
    // O IP da sua VM rodando liso!
    const FLARESOLVERR_URL = "http://136.112.249.42:8191/v1"; 

    const payload = {
        cmd: "request." + method.toLowerCase(),
        url: targetUrl,
        maxTimeout: 60000, // Dá 60 segundos pro trator trabalhar
        ...(method === "POST" && postData ? { postData } : {})
    };

    try {
        const response = await fetch(FLARESOLVERR_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        // ✅ AGORA VAMOS LER A RESPOSTA MESMO QUE DÊ ERRO
        const dataText = await response.text();
        let data: any = {};
        try { data = JSON.parse(dataText); } catch(e) {}

        // Se o status HTTP for erro ou o próprio FlareSolverr acusar erro
        if (!response.ok || data.status === "error") {
            const realError = data.message || data.error || dataText || `Erro HTTP ${response.status}`;
            throw new Error(`[Detalhe do FlareSolverr]: ${realError}`);
        }
        
        if (data.status === "ok" && data.solution?.response) {
            return {
                ok: true,
                html: data.solution.response, 
                cookies: data.solution.cookies 
            };
        } else {
            throw new Error("Falha na solução do Cloudflare (Sem HTML retornado)");
        }
    } catch (error: any) {
        console.error("[FlareSolverr Error]:", error.message);
        return { ok: false, html: "", error: error.message };
    }
}
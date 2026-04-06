// src/lib/api/flaresolverr.ts

export async function fetchViaFlareSolverr(
    targetUrl: string,
    method: "GET" | "POST" = "GET",
    postData?: string
) {
    // ⚠️ TROQUE PELO IP DA SUA VM E A PORTA QUE LIBERAMOS!
    const FLARESOLVERR_URL = "http://136.112.249.42:8191/v1"; 

    const payload = {
        cmd: "request." + method.toLowerCase(),
        url: targetUrl,
        maxTimeout: 60000,
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

        if (!response.ok) {
            throw new Error(`FlareSolverr falhou com status ${response.status}`);
        }

        const data = await response.json();
        
        if (data.status === "ok" && data.solution?.response) {
            return {
                ok: true,
                html: data.solution.response, // O HTML puro e limpo
                cookies: data.solution.cookies // Caso precise usar depois
            };
        } else {
            throw new Error("Falha na solução do Cloudflare");
        }
    } catch (error: any) {
        console.error("[FlareSolverr Error]:", error.message);
        return { ok: false, html: "", error: error.message };
    }
}
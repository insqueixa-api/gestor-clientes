// src/lib/api/flaresolverr.ts
const FLARESOLVERR_URL = "http://136.112.249.42:8191/v1";

export async function createFlareSession(proxyUrl?: string): Promise<string> {
    const payload: any = {
        cmd: "sessions.create",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    };

    if (proxyUrl) {
        payload.proxy = { url: proxyUrl };
    }

    const response = await fetch(FLARESOLVERR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (!response.ok || data.status === "error") {
        throw new Error(`[FlareSolverr Create Session]: ${data.message || 'Erro desconhecido'}`);
    }

    return data.session;
}

export async function requestWithFlare(
    sessionId: string, 
    targetUrl: string, 
    evaluateScript?: string,
    maxTimeout: number = 90000
) {
    const payload: any = {
        cmd: "request.get",
        session: sessionId,
        url: targetUrl,
        maxTimeout: maxTimeout,
        returnOnlyCookies: false
    };

    if (evaluateScript) {
        payload.evaluate = evaluateScript;
    }

    const response = await fetch(FLARESOLVERR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const dataText = await response.text();
    let data: any = {};
    try { data = JSON.parse(dataText); } catch(e) {}

    if (!response.ok || data.status === "error") {
        const realError = data.message || data.error || `Erro HTTP ${response.status}`;
        throw new Error(`[FlareSolverr Request]: ${realError}`);
    }

    if (data.status === "ok" && data.solution) {
        return {
            ok: true,
            html: data.solution.response || "",
            cookies: data.solution.cookies || []
        };
    }

    throw new Error("Falha na solução do Cloudflare (Sem HTML retornado)");
}

export async function destroyFlareSession(sessionId: string) {
    if (!sessionId) return;
    try {
        await fetch(FLARESOLVERR_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cmd: "sessions.destroy", session: sessionId })
        });
    } catch (e) {
        console.error("[FlareSolverr Destroy Error]:", e);
    }
}
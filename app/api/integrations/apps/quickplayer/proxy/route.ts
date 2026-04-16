import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, mac, playlist_name, playlist_url, pin, deviceKey } = body;

    const safeMac = (mac || "").trim().toUpperCase();
    const safeKey = (deviceKey || "").trim();
    const apiBase = "https://api.quickplayer.app/api";

    if (!safeMac || !safeKey) {
      return NextResponse.json({ ok: false, error: "MAC e Device Key são obrigatórios." }, { status: 400 });
    }

    // Headers comuns para simular um navegador
    const baseHeaders = {
      "accept": "application/json, text/plain, */*",
      "accept-language": "pt,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    };

    // 1. CAPTCHA (Aquecimento)
    await fetch(`${apiBase}/captcha`, { headers: baseHeaders }).catch(() => null);

    // 2. LOGIN
    const loginRes = await fetch(`${apiBase}/login_by_mac`, {
      method: "POST",
      headers: { ...baseHeaders, "content-type": "application/json" },
      body: JSON.stringify({ mac: safeMac, key: safeKey })
    });

    const loginData = await loginRes.json().catch(() => ({}));
    const token = loginData?.token || loginData?.data?.token;

    if (!loginRes.ok || !token) {
      return NextResponse.json({ ok: false, error: "Falha no Login. Verifique o MAC e Device Key." });
    }

    const authHeaders = { ...baseHeaders, "authorization": `Bearer ${token}` };

    // 3. BUSCAR DADOS DO DISPOSITIVO (Vencimento e Playlists Atuais)
    let expireDate = null;
    let existingPlaylists: any[] = [];
    
    const deviceRes = await fetch(`${apiBase}/device`, { headers: authHeaders });
    if (deviceRes.ok) {
        const deviceData = await deviceRes.json().catch(() => ({}));
        const rawExpire = deviceData?.message?.activation_expired || deviceData?.message?.free_trial_expired;
        if (rawExpire) {
            expireDate = rawExpire.split('T')[0]; // Pega só YYYY-MM-DD
        }
        existingPlaylists = deviceData?.message?.playlists || [];
    }

    // ==========================================
    // DELETAR
    // ==========================================
    if (action === "DELETE") {
        for (const pl of existingPlaylists) {
            // Remove se o nome bater
            if (pl.name === playlist_name || pl.name.includes(playlist_name)) {
                await fetch(`${apiBase}/palylist_from_web`, { // Escrito palylist na API original
                    method: "DELETE",
                    headers: { ...authHeaders, "content-type": "application/json" },
                    body: JSON.stringify({ id: pl.id, pin: pin || "" })
                });
            }
        }
        return NextResponse.json({ ok: true, message: "Playlist removida do painel." });
    }

    // ==========================================
    // CRIAR
    // ==========================================
    if (action === "CREATE") {
        const formData = new FormData();
        formData.append("name", playlist_name);
        formData.append("mac", safeMac);
        formData.append("url", playlist_url);
        
        if (pin) {
            formData.append("is_protected", "true");
            formData.append("pin", pin);
            formData.append("confirm_pin", pin);
        } else {
            formData.append("is_protected", "false");
        }

        const createRes = await fetch(`${apiBase}/playlist_with_mac`, {
            method: "POST",
            headers: authHeaders, // FormData não precisa de content-type manual
            body: formData
        });

        const createJson = await createRes.json().catch(() => ({}));

        if (!createRes.ok || createJson?.error) {
            return NextResponse.json({ ok: false, error: createJson?.message || "Falha ao enviar lista." });
        }

        // Retorna ok = true e repassa a data de vencimento para o UniGestor salvar no banco!
        return NextResponse.json({ 
            ok: true, 
            message: "Aplicativo configurado com sucesso!",
            expireDate: expireDate 
        });
    }

    return NextResponse.json({ ok: false, error: "Ação inválida." }, { status: 400 });

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
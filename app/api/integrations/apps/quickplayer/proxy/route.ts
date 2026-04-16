import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, mac, playlist_name, playlist_url, pin, deviceKey, base_url } = body;

    // Mantendo a formatação original que o usuário digitou
    const safeMac = (mac || "").trim(); 
    const safeKey = (deviceKey || "").trim();
    const apiBase = (base_url || "https://api.quickplayer.app/api").replace(/\/$/, "");

    if (!safeMac || !safeKey) {
      return NextResponse.json({ ok: false, error: "MAC e Device Key são obrigatórios." }, { status: 400 });
    }

    // Headers comuns para simular um navegador
    const baseHeaders = {
      "accept": "application/json, text/plain, */*",
      "accept-language": "pt,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    };

    // ==========================================
    // FLUXO DE LOGIN (A "dança" do Quick Player)
    // ==========================================
    
    // Passo 1: Valida o MAC (Avisa a API que vamos logar)
    const valRes = await fetch(`${apiBase}/validate_mac?mac=${encodeURIComponent(safeMac)}`, { headers: baseHeaders });
    if (!valRes.ok) {
        console.log("QuickPlayer Proxy: Falha no validate_mac", valRes.status);
    }

    // Passo 2: CAPTCHA (Aquece a sessão invisível)
    await fetch(`${apiBase}/captcha`, { headers: baseHeaders }).catch(() => null);

    // Passo 3: LOGIN DE FATO
    const loginRes = await fetch(`${apiBase}/login_by_mac`, {
      method: "POST",
      headers: { ...baseHeaders, "content-type": "application/json" },
      body: JSON.stringify({ mac: safeMac, key: safeKey })
    });

    if (!loginRes.ok) {
      const text = await loginRes.text();
      console.log("QuickPlayer Proxy: Falha no login", loginRes.status, text);
      return NextResponse.json({ ok: false, error: `Falha no Login (HTTP ${loginRes.status}). Pode ser bloqueio de segurança.` });
    }

    const loginData = await loginRes.json().catch(() => ({}));
    const token = loginData?.token || loginData?.data?.token;

    if (!token) {
      return NextResponse.json({ ok: false, error: loginData?.message || "Falha no Login. Token não retornado." });
    }

    const authHeaders = { ...baseHeaders, "authorization": `Bearer ${token}` };

    // Passo 4: BUSCAR DADOS DO DISPOSITIVO (Vencimento e Playlists)
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
    // AÇÃO: DELETAR
    // ==========================================
    if (action === "DELETE") {
        let deletedAny = false;
        for (const pl of existingPlaylists) {
            if (pl.name === playlist_name || pl.name.includes(playlist_name)) {
                const delRes = await fetch(`${apiBase}/palylist_from_web`, { // Nome oficial da API deles
                    method: "DELETE",
                    headers: { ...authHeaders, "content-type": "application/json" },
                    body: JSON.stringify({ id: pl.id, pin: pin || "" })
                });
                if (delRes.ok) deletedAny = true;
            }
        }
        return NextResponse.json({ ok: true, message: deletedAny ? "Playlist removida." : "Nenhuma playlist encontrada." });
    }

    // ==========================================
    // AÇÃO: CRIAR
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
            headers: authHeaders, // O Node trata o boundary do FormData automaticamente
            body: formData
        });

        if (!createRes.ok) {
            const text = await createRes.text();
            console.log("QuickPlayer Proxy: Falha ao Criar", createRes.status, text);
            return NextResponse.json({ ok: false, error: `Falha HTTP ${createRes.status} ao enviar lista.` });
        }

        const createJson = await createRes.json().catch(() => ({}));
        if (createJson?.error) {
            return NextResponse.json({ ok: false, error: createJson?.message || "Erro da API do Quick Player ao salvar." });
        }

        return NextResponse.json({ 
            ok: true, 
            message: "Aplicativo configurado com sucesso!",
            expireDate: expireDate 
        });
    }

    return NextResponse.json({ ok: false, error: "Ação inválida." }, { status: 400 });

  } catch (err: any) {
    console.error("QuickPlayer Proxy Exception:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
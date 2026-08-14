import "dotenv/config";
import express from "express";
import QRCode from "qrcode";
import path from "path";
import { fileURLToPath } from "url";

import {
  createSession, disconnectSession, reconnectSession, hardResetSession, sendMessage, validateNumber,
  getSession, getAllSessions, restoreExistingSessions, qrCallbacks,
  getSessionConfig, updateSessionConfig, getContactProfilePicture,
} from "./sessionManager.js";
import { runDuplecastAction } from "./duplecastClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.error("❌ FATAL: API_TOKEN não definido no .env");
  process.exit(1);
}

// ── Rede de segurança de processo ──────────────────────────────────────────
// Antes disto, um erro não tratado em QUALQUER lugar do código (um evento
// assíncrono do Baileys, uma promise esquecida) derrubava o processo inteiro
// sem nenhum log específico — só o crash dump padrão do Node. O Docker já
// reinicia o container sozinho (restart: unless-stopped), então isso não é
// sobre "impedir o crash", é sobre DEIXAR RASTRO de por que ele aconteceu,
// e não sacrificar TODAS as sessões/tenants por um erro isolado numa só.
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection:", reason?.stack || reason);
});
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err?.stack || err);
});

app.use(express.json());

// ── Logs de acesso inteligentes (Silencia o Polling e 404) ───────────
app.use((req, res, next) => {
  // ✅ Pula o log se a URL COMEÇAR com alguma dessas rotas (ignora os parâmetros)
  const isQuiet = ["/health", "/status", "/profile", "/sessions", "/session-config"].some(path => 
    req.url.startsWith(path) || req.path.startsWith(path)
  );
  
  if (isQuiet) return next();

  const start = Date.now();
  res.on("finish", () => {
    // 🔥 SILENCIA OS 404: Não exibe logs de rotas que não existem (Evita poluição de bots de internet e URLs raiz)
    if (res.statusCode === 404) return;

    const ms = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ── Autenticação ─────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (!token || token !== API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Extrai sessionKey do header x-session-key
function getSessionKey(req) {
  return (req.headers["x-session-key"] || "").trim();
}

// ─────────────────────────────────────────────────────────────
// ROTAS
// ─────────────────────────────────────────────────────────────

// Health check (sem auth)
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Lista todas as sessões ativas
app.get("/sessions", authMiddleware, (req, res) => {
  res.json({ sessions: getAllSessions() });
});

// Adiciona antes do "── 404 ───":
// ── GET /profile-picture ─────────────────────────────────────
app.get("/profile-picture", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  const jid = (req.query.jid || "").trim();
  if (!jid) return res.status(400).json({ error: "jid é obrigatório" });

  const sess = getSession(sessionKey);
  if (!sess || sess.status !== "connected") {
    return res.status(503).json({ error: "Sessão não conectada" });
  }

  try {
    const result = await getContactProfilePicture(sessionKey, jid);
    return res.json(result); // { url: "https://..." } ou { url: null }
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Erro ao buscar foto" });
  }
});

// ── ANY /status (Suporta GET e POST para evitar 404) ──────────
app.all("/status", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  const sess = getSession(sessionKey);

  if (!sess) {
    return res.json({ connected: false, status: "disconnected" });
  }

  // ✅ Se estiver no meio de uma reconexão ou carregando (connecting),
  // avisamos que está "conneting" mas não setamos connected: false abruptamente
  // se ele ainda não esgotou as tentativas.
  const isConnectedOrReconnecting = sess.status === "connected" || sess.status === "connecting";

  return res.json({
    connected: isConnectedOrReconnecting,
    status: sess.status,
  });
});

// ── Validar número WhatsApp ──────────────────────────────────
app.post("/validate-number", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone obrigatório" });

  const sess = getSession(sessionKey);
  if (!sess || sess.status !== "connected") {
    return res.status(503).json({ error: "Sessão não conectada" });
  }

  try {
    const digits = String(phone).replace(/\D/g, "");
    const jid = `${digits}@s.whatsapp.net`;
    const [result] = await sess.socket.onWhatsApp(jid);
    return res.json({
      exists: !!result?.exists,
      jid: result?.jid || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Erro ao validar" });
  }
});

// ── GET /qr ──────────────────────────────────────────────────
app.get("/qr", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  let sess = getSession(sessionKey);

  // Se já conectado, retorna status sem QR
  if (sess?.status === "connected") {
    return res.json({ qr: null, connected: true, status: "connected" });
  }

  // Inicia sessão se não existir
  if (!sess) {
    sess = await createSession(sessionKey);
  }

  // Se já tem QR disponível, retorna como base64
  if (sess.qr) {
    try {
      const qrBase64 = await QRCode.toDataURL(sess.qr);
      return res.json({ qr: qrBase64, connected: false, status: "qr" });
    } catch (e) {
      return res.status(500).json({ error: "Falha ao gerar QR" });
    }
  }

  // Aguarda QR aparecer (timeout 15s)
  const qr = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      qrCallbacks.delete(sessionKey);
      resolve(null);
    }, 15_000);

    qrCallbacks.set(sessionKey, (qrValue) => {
      clearTimeout(timer);
      qrCallbacks.delete(sessionKey);
      resolve(qrValue);
    });
  });

  if (!qr) {
    // Pode estar conectando ainda — verifica
    const current = getSession(sessionKey);
    if (current?.status === "connected") {
      return res.json({ qr: null, connected: true, status: "connected" });
    }
    return res.json({ qr: null, connected: false, status: current?.status || "connecting" });
  }

  try {
    const qrBase64 = await QRCode.toDataURL(qr);
    return res.json({ qr: qrBase64, connected: false, status: "qr" });
  } catch (e) {
    return res.status(500).json({ error: "Falha ao gerar QR" });
  }
});

// ── GET /profile ──────────────────────────────────────────────
app.get("/profile", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  const sess = getSession(sessionKey);

  if (!sess || sess.status !== "connected") {
    return res.json({ connected: false, status: sess?.status || "disconnected", jid: null, pushName: null, pictureUrl: null });
  }

  return res.json({
    connected: true,
    status: "connected",
    jid: sess.jid,
    pushName: sess.pushName,
    pictureUrl: sess.pictureUrl,
  });
});

// ── POST /disconnect ─────────────────────────────────────────
app.post("/disconnect", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  try {
    await disconnectSession(sessionKey);
    return res.json({ success: true, status: "disconnected" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Falha ao desconectar" });
  }
});

// ── POST /reconnect ──────────────────────────────────────────
app.post("/reconnect", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  try {
    await reconnectSession(sessionKey);
    return res.json({ success: true, status: "reconnecting" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Falha ao reconectar" });
  }
});

// ── POST /send ────────────────────────────────────────────────
app.post("/send", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  // ✅ EXTRAI A IMAGEM TAMBÉM
  const { phone, message, image_url, skip_typing_delay } = req.body || {};
  if (!phone || !message) {
    return res.status(400).json({ error: "phone e message são obrigatórios" });
  }

  const sess = getSession(sessionKey);
  if (!sess || sess.status !== "connected") {
    return res.status(503).json({ error: "Sessão não conectada", status: sess?.status || "disconnected" });
  }

  try {
    // ✅ PASSA A IMAGEM PARA A FUNÇÃO (SE EXISTIR)
    // ✅ skip_typing_delay: quem já simulou "digitando..." antes de chamar aqui
    // (hoje só o bot, durante o debounce) manda essa flag pra não duplicar.
    const result = await sendMessage(sessionKey, phone, message, image_url, {
      skipTypingSimulation: !!skip_typing_delay,
    });
    return res.json(result);
  } catch (e) {
    console.error(`[SEND] Erro:`, e?.message);
    return res.status(502).json({ error: e?.message || "Falha ao enviar mensagem" });
  }
});

// ── POST /validate ────────────────────────────────────────────
// Verifica se um número está registrado no WhatsApp
app.post("/validate", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  const { phone } = req.body || {};
  if (!phone) {
    return res.status(400).json({ error: "phone é obrigatório" });
  }

  const sess = getSession(sessionKey);
  if (!sess || sess.status !== "connected") {
    return res.status(503).json({ error: "Sessão não conectada" });
  }

  try {
    const result = await validateNumber(sessionKey, phone);
    return res.json(result);
  } catch (e) {
    console.error(`[VALIDATE] Erro:`, e?.message);
    return res.status(502).json({ error: e?.message || "Falha ao validar número" });
  }
});

// ── GET /session-config ───────────────────────────────────────
app.get("/session-config", authMiddleware, (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  const config = getSessionConfig(sessionKey);
  return res.json(config);
});

// ── POST /session-config ──────────────────────────────────────
app.post("/session-config", authMiddleware, (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

const { rejectCalls, rejectMessage, allowedNumbers, tenantId } = req.body || {};
const config = updateSessionConfig(sessionKey, { rejectCalls, rejectMessage, allowedNumbers, tenantId });
  return res.json({ ok: true, config });
});

// ── POST /system/restart ────────────────────────────────────
app.post("/system/restart", authMiddleware, async (req, res) => {
  console.log("[SYSTEM] Restart solicitado via API");
  res.json({ ok: true, message: "Reiniciando serviço..." });
  setTimeout(() => process.exit(0), 500);
});

// ── POST /system/hard-reset ───────────────────────────────────
// Apaga TODAS as pastas de sessão (credenciais completas, sem preservar
// config) das sessionKeys informadas e reinicia o processo — o Docker
// (restart: unless-stopped) sobe o container de novo sozinho, mas como as
// pastas já não existem mais, restoreExistingSessions() não tenta
// reconectar nenhuma delas. Fica "em branco" até alguém pedir QR novo pelo
// admin. Pedido do Márcio (26/07/2026) — reconectar com QR novo não
// resolveu a entrega, então quis a garantia de um reset total, sem
// nenhum resquício de credencial antiga.
app.post("/system/hard-reset", authMiddleware, async (req, res) => {
  const { sessionKeys } = req.body || {};
  if (!Array.isArray(sessionKeys) || sessionKeys.length === 0) {
    return res.status(400).json({ error: "sessionKeys (array) é obrigatório" });
  }

  console.log(`[SYSTEM] Hard reset solicitado via API para ${sessionKeys.length} sessão(ões)`);

  for (const key of sessionKeys) {
    try {
      await hardResetSession(String(key));
    } catch (e) {
      console.error(`[SYSTEM] Falha no hard reset de ${String(key).slice(0, 8)}:`, e?.message);
    }
  }

  res.json({ ok: true, reset: sessionKeys, message: "Sessões apagadas. Reiniciando serviço..." });
  setTimeout(() => process.exit(0), 500);
});

// (removido em 27/07/2026) GerenciaApp saiu da VM de vez — agora roda
// direto em app/api/integrations/apps/gerenciaapp/route.ts (Next.js),
// usando o portal /ativador (login só por MAC) em vez do painel admin
// /users que motivou essa rota aqui. Ver memória do projeto pro histórico
// completo (dois bugs de dados reais encontrados no fluxo antigo).

// ── POST /fast-sync/proxy-m3u ─────────────────────────────────
// Relay puro pro M3U do Fast: a Vercel não consegue baixar direto (IP de
// datacenter dela é bloqueado, HTTP 403), mas a VM pode. Em vez de logar num
// storage intermediário (R2 — testado, funciona, mas tem overhead de upload
// +download), a VM baixa e devolve o conteúdo na hora, na própria resposta —
// pra Vercel é como se tivesse baixado ela mesma, só que apontando pra cá.
app.post("/fast-sync/proxy-m3u", authMiddleware, async (req, res) => {
  const { m3uUrl } = req.body || {};
  if (!m3uUrl) {
    return res.status(400).json({ error: "m3uUrl é obrigatório." });
  }
  try {
    console.log("[FAST-PROXY] Baixando M3U...");
    const upstream = await fetch(m3uUrl, {
      headers: { "User-Agent": "IPTVSmartersPro", "Accept": "*/*" },
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Falha ao baixar M3U: HTTP ${upstream.status}` });
    }
    const text = await upstream.text();
    console.log(`[FAST-PROXY] ${text.length} bytes — devolvendo pra Vercel`);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(text);
  } catch (e) {
    console.error("[FAST-PROXY] erro:", e?.message);
    res.status(502).json({ error: e?.message || "Falha ao baixar M3U do Fast." });
  }
});

// ── POST /duplecast/action ────────────────────────────────────
// A Vercel não consegue passar do Cloudflare do duplecast.com (desafio
// "Just a moment", bloqueia qualquer requisição sem motor de JS — testado de
// vários IPs, não é reputação de IP). Aqui na VM tem o FlareSolverr
// (container local, docker-compose.yml) resolvendo o desafio uma vez; o
// resto do fluxo (login, criar/checar/apagar playlist) reaproveita os
// cookies direto — ver duplecastClient.js pro porquê disso funcionar.
app.post("/duplecast/action", authMiddleware, async (req, res) => {
  try {
    const result = await runDuplecastAction(req.body || {});
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("[DUPLECAST] erro:", e?.message);
    res.status(e?.notFound ? 404 : 500).json({ ok: false, error: e?.message || "Erro no Duplecast." });
  }
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

// ── Inicialização ─────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`🚀 UniGestor WhatsApp Service rodando na porta ${PORT}`);
  console.log(`📁 Sessões em: auth/`);
  await restoreExistingSessions();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[WA] SIGTERM recebido — encerrando...");
  process.exit(0);
});

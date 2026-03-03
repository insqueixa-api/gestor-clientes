import "dotenv/config";
import express from "express";
import QRCode from "qrcode";

import {
  createSession,
  disconnectSession,
  sendMessage,
  validateNumber,
  getSession,
  getAllSessions,
  restoreExistingSessions,
  qrCallbacks,
  getSessionConfig,
  updateSessionConfig,
} from "./sessionManager.js";

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.error("❌ FATAL: API_TOKEN não definido no .env");
  process.exit(1);
}

app.use(express.json());

// ── Logs de acesso simples ───────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
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

// ── GET /status ──────────────────────────────────────────────
app.get("/status", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  const sess = getSession(sessionKey);

  if (!sess) {
    return res.json({ connected: false, status: "disconnected" });
  }

  return res.json({
    connected: sess.status === "connected",
    status: sess.status,
  });
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

// ── POST /send ────────────────────────────────────────────────
app.post("/send", authMiddleware, async (req, res) => {
  const sessionKey = getSessionKey(req);
  if (!sessionKey) return res.status(400).json({ error: "x-session-key obrigatório" });

  const { phone, message } = req.body || {};
  if (!phone || !message) {
    return res.status(400).json({ error: "phone e message são obrigatórios" });
  }

  const sess = getSession(sessionKey);
  if (!sess || sess.status !== "connected") {
    return res.status(503).json({ error: "Sessão não conectada", status: sess?.status || "disconnected" });
  }

  try {
    const result = await sendMessage(sessionKey, phone, message);
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

const { rejectCalls, rejectMessage, allowedNumbers } = req.body || {};
const config = updateSessionConfig(sessionKey, { rejectCalls, rejectMessage, allowedNumbers });
  return res.json({ ok: true, config });
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

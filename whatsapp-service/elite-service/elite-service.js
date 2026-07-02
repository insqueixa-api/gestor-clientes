// /opt/whatsapp-service/elite-service/elite-service.js
//
// Serviço Express + Puppeteer para automatizar o painel Elite (Cloudflare-protected).
// Roda FORA do Docker do WhatsApp, gerenciado via PM2, na porta 3001.
//
// FASE 1: apenas /elite/sync (leitura de saldo). CREATE_TRIAL e RENEW vêm depois.

const express = require("express");
const puppeteer = require("puppeteer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());

const PORT = process.env.ELITE_PORT || 3001;
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "";
const PROFILES_DIR = path.join(__dirname, "profiles");

if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });

// --- Auth: mesmo header x-internal-secret que a API do UniGestor já usa ---
function checkAuth(req, res, next) {
  const provided = String(req.headers["x-internal-secret"] || "");
  if (!INTERNAL_SECRET) {
    return res.status(500).json({ ok: false, error: "elite-service sem INTERNAL_API_SECRET configurado no .env" });
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(INTERNAL_SECRET);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) return res.status(401).json({ ok: false, error: "Unauthorized" });
  next();
}
app.use(checkAuth);

// --- Sessão persistente por (baseUrl + username), separada em pastas de perfil ---
function profileDirFor(baseUrl, username) {
  const key = crypto.createHash("md5").update(`${baseUrl}:${username}`).digest("hex");
  return path.join(PROFILES_DIR, key);
}

async function withBrowser(baseUrl, username, fn) {
  const userDataDir = profileDirFor(baseUrl, username);
  const browser = await puppeteer.launch({
    headless: "new",
    userDataDir,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

// --- Lógica adaptada do background.js (mesma leitura: Livewire snapshot -> fallback DOM) ---
async function readCreditsFromPage(page) {
  return page.evaluate(() => {
    const snapshots = document.querySelectorAll("[wire\\:snapshot]");
    for (const snap of snapshots) {
      try {
        const raw = snap.getAttribute("wire:snapshot");
        const decoded = raw.replace(/&quot;/g, '"');
        const data = JSON.parse(decoded);
        const st = data?.data?.state?.[0];
        if (st && st.credits !== undefined) {
          return { status: "success", saldo: String(st.credits), loggedUser: st.username || "" };
        }
      } catch (e) {}
    }

    const creditsEl = document.querySelector("#navbarCredits") || document.querySelector("#updatecredits");
    if (creditsEl && creditsEl.textContent) {
      const saldo = creditsEl.textContent.replace(/[^\d.,]/g, "").trim();
      if (saldo) {
        const userEl = document.querySelector(".dropdown-user h6");
        return { status: "success", saldo, loggedUser: userEl ? userEl.textContent.trim() : "" };
      }
    }

    const errEl = document.querySelector(".invalid-feedback, .alert-danger, .text-danger");
    if (errEl && (errEl.textContent.toLowerCase().includes("match") || errEl.textContent.toLowerCase().includes("inválid"))) {
      return { status: "error", message: "Credenciais inválidas. Verifique usuário e senha da integração." };
    }

    const emailInput = document.querySelector('input[type="email"], input[name="email"], input[name="username"]');
    const passInput = document.querySelector('input[type="password"], input[name="password"]');
    const btn =
      document.querySelector('button[type="submit"]') ||
      Array.from(document.querySelectorAll("button")).find((b) => b.textContent.toLowerCase().includes("entrar"));

    if (emailInput && passInput && btn) {
      return { status: "needs_login" };
    }

    return { status: "loading" };
  });
}

async function ensureLoggedInAndReadCredits(page, baseUrl, username, password) {
  await page.goto(`${baseUrl}/user/profile`, { waitUntil: "networkidle2", timeout: 30000 });

  // Espera Cloudflare resolver sozinho (sessão residencial + cookies válidos devem passar direto)
  await page
    .waitForFunction(
      () => {
        const title = document.title.toLowerCase();
        const html = document.body ? document.body.innerHTML.toLowerCase() : "";
        return !title.includes("just a moment") && !html.includes("cf-turnstile");
      },
      { timeout: 30000 }
    )
    .catch(() => {});

  const maxAttempts = 15; // ~22s de polling, igual ao espírito do código da extensão
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const state = await readCreditsFromPage(page);
    console.log(`[elite-service] tentativa ${attempt + 1}/${maxAttempts}: status=${state.status} url=${page.url()}`);

    if (state.status === "success") return state;
    if (state.status === "error") throw new Error(state.message);

    if (state.status === "needs_login") {
      await page.evaluate(
        (user, pass) => {
          const emailInput = document.querySelector('input[type="email"], input[name="email"], input[name="username"]');
          const passInput = document.querySelector('input[type="password"], input[name="password"]');
          emailInput.value = user;
          passInput.value = pass;
          emailInput.dispatchEvent(new Event("input", { bubbles: true }));
          passInput.dispatchEvent(new Event("input", { bubbles: true }));
        },
        username,
        password
      );

      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}),
        page.click('button[type="submit"]').catch(() => {}),
      ]);
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  // Timeout: salva screenshot + HTML pra diagnóstico visual
  try {
    const debugDir = path.join(__dirname, "debug");
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: path.join(debugDir, "timeout.png"), fullPage: true });
    const html = await page.content();
    fs.writeFileSync(path.join(debugDir, "timeout.html"), html);
    console.log(`[elite-service] Timeout — screenshot e HTML salvos em ${debugDir}`);
  } catch (debugErr) {
    console.log(`[elite-service] Falha ao salvar debug: ${debugErr.message}`);
  }

  throw new Error("Timeout: não foi possível confirmar login/saldo dentro do tempo esperado.");
}

// --- Rota principal: FASE 1 ---
app.post("/elite/sync", async (req, res) => {
  const { baseUrl, username, password } = req.body || {};
  if (!baseUrl || !username || !password) {
    return res.status(400).json({ ok: false, error: "baseUrl, username e password são obrigatórios." });
  }

  const cleanBaseUrl = String(baseUrl).replace(/\/$/, "");

  try {
    const result = await withBrowser(cleanBaseUrl, username, (page) =>
      ensureLoggedInAndReadCredits(page, cleanBaseUrl, username, password)
    );
    return res.json({ ok: true, saldo: result.saldo, loggedUser: result.loggedUser });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ ok: true, service: "elite-service", ts: Date.now() }));

app.listen(PORT, () => {
  console.log(`[elite-service] rodando na porta ${PORT}`);
});
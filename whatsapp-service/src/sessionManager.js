import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import pino from "pino";
import { Writable } from "stream";
import { HttpsProxyAgent } from "https-proxy-agent";

// ✅ Proxy residencial pro socket do WhatsApp (pedido do Márcio, 26/07/2026)
// — achado real: conexão saindo direto do IP de datacenter da Hetzner batia
// 401 (loggedOut) repetido a cada reconexão, o WhatsApp derrubando o
// "aparelho vinculado" de propósito por reconhecer padrão de datacenter.
// Roteando pelo mesmo provedor residencial já usado no GerenciaApp — hoje
// "Proxy BR" (ipbr.pro; era DataImpulse, trocado depois da 5ª rodada) — via
// `agent`/`fetchAgent` do Baileys (suporte nativo:
// https://mintlify.wiki/whiskeysockets/Baileys/api/socket-config), a
// conexão passa a sair de um IP residencial brasileiro fixo em vez do IP da
// VM. Env var PRÓPRIA (WHATSAPP_PROXY_URL), separada de GERENCIAAPP_PROXY_URL
// — mesmo provedor/mesma credencial hoje, mas dá pra apontar pra uma
// sessão/IP diferente se precisar (ex: não competir com o scraping do
// GerenciaApp). Único IP pra todas as sessões WhatsApp da VM — ver auditoria
// de 05/08/2026 (memória de projeto) sobre o risco de correlação entre
// números que isso implica; decisão do Márcio foi manter assim por ora.
const WA_PROXY_URL = String(process.env.WHATSAPP_PROXY_URL || "").trim();
if (WA_PROXY_URL) {
  console.log("[WA] Proxy residencial ativo pra conexão com o WhatsApp");
}

// Adiciona no topo do arquivo, após os imports:
const processedCalls = new Map();

// ✅ 05/09/2026, achado numa investigação urgente de "Aguardando mensagem"/
// mensagem vazia (pedido do Márcio): os erros abaixo (Bad MAC, Failed to
// decrypt, Session error, Closing session) eram só descartados como
// "cosmético" — mas são EXATAMENTE o sintoma que ele reportou. Agora conta
// em vez de só descartar, e avisa a cada 5 min (sem voltar a pichar o log
// linha a linha, que foi o motivo original da supressão).
let sessionErrorCount = 0;
setInterval(() => {
  if (sessionErrorCount > 0) {
    console.log(`[WA][SESSION_HEALTH] ${sessionErrorCount} erro(s) de sessão/decriptação (Bad MAC/Failed to decrypt/Closing session) nos últimos 5 min`);
    sessionErrorCount = 0;
  }
}, 5 * 60 * 1000);

// Suprime logs verbosos de ERRO do libsignal (Bad MAC de sessões antigas — erro cosmético)
const _origConsoleError = console.error;
console.error = (...args) => {
  const msg = String(args[0] || "");
  if (msg.includes("Bad MAC") || msg.includes("Failed to decrypt") || msg.includes("Session error")) {
    sessionErrorCount++;
    return;
  }
  _origConsoleError(...args);
};

// Suprime logs verbosos de SUCESSO/INFO do libsignal (Bloqueia aquele texto gigante de chaves "Closing session")
const _origConsoleLog = console.log;
console.log = (...args) => {
  const msg = String(args[0] || "");
  if (msg.includes("Closing open session in favor") || msg.includes("Closing session: SessionEntry")) {
    sessionErrorCount++;
    return;
  }
  _origConsoleLog(...args);
};

// Suprime output direto do Baileys no stdout (Closing session, etc)
const _origStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  const msg = String(chunk);
  if (
    msg.includes("Closing open session") ||
    msg.includes("Closing session: SessionEntry") ||
    msg.includes("SessionEntry {") ||
    msg.includes("Decrypted message with closed session")
  ) {
    sessionErrorCount++;
    return true;
  }
  return _origStdoutWrite(chunk, ...args);
};

const _origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  const msg = String(chunk);
  if (
    msg.includes("Closing open session") ||
    msg.includes("Closing session: SessionEntry") ||
    msg.includes("SessionEntry {") ||
    msg.includes("Decrypted message with closed session")
  ) {
    sessionErrorCount++;
    return true;
  }
  return _origStderrWrite(chunk, ...args);
};

function isCallAlreadyProcessed(callId) {
  const now = Date.now();
  // Limpa entradas antigas (> 2 minutos)
  for (const [id, ts] of processedCalls.entries()) {
    if (now - ts > 120_000) processedCalls.delete(id);
  }
  if (processedCalls.has(callId)) return true;
  processedCalls.set(callId, now);
  return false;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(__dirname, "../auth");

// ✅ 05/09/2026, pedido do Márcio: o fingerprint do "aparelho vinculado"
// (Mac OS/Chrome, ver `browser:` no makeWASocket abaixo) tava congelado no
// Chrome 124 desde 01/08/2026 — mais de um ano parado enquanto um Chrome de
// verdade se atualiza sozinho o tempo todo, um padrão que sistemas
// antifraude associam a automação. Busca a versão estável atual na API
// pública do Google, cacheia em disco (sobrevive a restart do container) e
// se atualiza sozinho 1x/dia — sem precisar de ninguém lembrar de trocar
// manualmente. Se a busca falhar (rede fora, API fora do ar), mantém o
// último valor bom conhecido; nunca derruba a conexão por causa disso.
const CHROME_VERSION_CACHE_FILE = path.resolve(AUTH_DIR, "../chrome-version-cache.json");
const CHROME_VERSION_FALLBACK = "130.0.6723.117";
let currentChromeVersion = CHROME_VERSION_FALLBACK;

function loadChromeVersionCache() {
  try {
    const raw = fs.readFileSync(CHROME_VERSION_CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version && /^\d+\.\d+\.\d+\.\d+$/.test(parsed.version)) {
      currentChromeVersion = parsed.version;
    }
  } catch {}
}

async function refreshChromeVersion() {
  try {
    const res = await fetch(
      "https://versionhistory.googleapis.com/v1/chrome/platforms/mac/channels/stable/versions",
      { signal: AbortSignal.timeout(10_000) },
    );
    const json = await res.json();
    const version = json?.versions?.[0]?.version;
    if (version && /^\d+\.\d+\.\d+\.\d+$/.test(version) && version !== currentChromeVersion) {
      currentChromeVersion = version;
      fs.writeFileSync(
        CHROME_VERSION_CACHE_FILE,
        JSON.stringify({ version, updatedAt: new Date().toISOString() }),
      );
      console.log(`[WA] Fingerprint do Chrome atualizado automaticamente pra ${version}`);
    }
  } catch (e) {
    console.log(`[WA] Falha ao checar versão atual do Chrome (mantendo ${currentChromeVersion}): ${e.message}`);
  }
}

loadChromeVersionCache();
refreshChromeVersion(); // não bloqueia o startup — roda em paralelo
setInterval(refreshChromeVersion, 24 * 60 * 60 * 1000); // 1x/dia

// Mensagem enviada ao rejeitar chamadas
const DEFAULT_REJECT_MESSAGE =
  process.env.CALL_REJECT_MESSAGE ||
  "Olá! Não recebo ligações pelo WhatsApp. Por favor, envie uma mensagem e aguarde meu retorno. Obrigado! 😊";

// Config por sessão: { rejectCalls: bool, rejectMessage: string }
const sessionConfigs = new Map();
const CONFIG_DIR = path.resolve(AUTH_DIR, "_config");

function getConfigPath(sessionKey) {
  return path.join(CONFIG_DIR, sessionKey, "wa-config.json");
}

function getSessionConfig(sessionKey) {
  if (sessionConfigs.has(sessionKey)) return sessionConfigs.get(sessionKey);

  // tenta carregar do disco
  try {
    const file = getConfigPath(sessionKey);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      sessionConfigs.set(sessionKey, data);
      return data;
    }
  } catch {}

  const defaults = {
    rejectCalls: true,
    rejectMessage: DEFAULT_REJECT_MESSAGE,
    allowedNumbers: [],
    tenantId: null,      // preenchido quando admin salva as configurações
  };
  sessionConfigs.set(sessionKey, defaults);
  return defaults;
}

function updateSessionConfig(sessionKey, updates) {
  const current = getSessionConfig(sessionKey);
  const next = {
    ...current,
    ...(updates.rejectCalls !== undefined ? { rejectCalls: !!updates.rejectCalls } : {}),
    ...(updates.rejectMessage !== undefined ? { rejectMessage: String(updates.rejectMessage) } : {}),
    ...(Array.isArray(updates.allowedNumbers) ? { allowedNumbers: updates.allowedNumbers } : {}),
    ...(updates.tenantId !== undefined ? { tenantId: String(updates.tenantId) } : {}),
  };
  sessionConfigs.set(sessionKey, next);

  // Quando salvar números permitidos, resolve os lids via socket e salva no mapa
  if (Array.isArray(updates.allowedNumbers) && updates.allowedNumbers.length > 0) {
    const sess = sessions.get(sessionKey);
    if (sess?.socket && sess.status === "connected") {
      (async () => {
        for (const num of updates.allowedNumbers) {
          const digits = String(num).replace(/\D/g, "");
          if (!digits) continue;
          try {
            // Pede à API do WhatsApp as informações do número
            const [info] = await sess.socket.onWhatsApp(`${digits}@s.whatsapp.net`).catch(() => [null]);
            rememberLidMapping(sessionKey, digits, info?.lid);
          } catch {}
        }
        saveLidMap(sessionKey);
      })();
    }
  }

  // persiste no disco
  try {
    const dir = path.join(CONFIG_DIR, sessionKey);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getConfigPath(sessionKey), JSON.stringify(next, null, 2));
  } catch (e) {
    console.error(`[CONFIG] Falha ao salvar config:`, e?.message);
  }

  return next;
}

// ── Persistência do mapa lid→phone ───────────────────────────
function getLidMapPath(sessionKey) {
  return path.join(CONFIG_DIR, sessionKey, "lid-map.json");
}

function saveLidMap(sessionKey) {
  try {
    const map = lidPhoneMap.get(sessionKey);
    if (!map) return;
    const obj = Object.fromEntries(map);
    const dir = path.join(CONFIG_DIR, sessionKey);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getLidMapPath(sessionKey), JSON.stringify(obj));
  } catch {}
}

function loadLidMap(sessionKey) {
  try {
    const file = getLidMapPath(sessionKey);
    if (!fs.existsSync(file)) return;
    const obj = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!lidPhoneMap.has(sessionKey)) lidPhoneMap.set(sessionKey, new Map());
    const map = lidPhoneMap.get(sessionKey);
    for (const [k, v] of Object.entries(obj)) map.set(k, v);
    console.log(`[WA] lid-map carregado: ${map.size} entradas`);
  } catch {}
}

// Registra telefone↔LID no mapa em memória a partir de um `info.lid` cru
// devolvido pelo Baileys (ex: sock.onWhatsApp(...)). Mesmo "pulo do gato" que
// já existia só no fluxo de salvar `allowedNumbers` (acima) — agora também
// chamado em validateNumber(), pra popular o mapa em toda validação de
// número, não só quando a lista de permitidos é salva. Puramente aditivo:
// não muda o que validateNumber/sendMessage retornam ou enviam, só deixa o
// mapa que já resolve LID→telefone nas mensagens/ligações recebidas mais
// completo com o tempo.
function rememberLidMapping(sessionKey, digits, lidRaw) {
  if (!digits || !lidRaw) return;
  try {
    const lidBase = String(lidRaw).split("@")[0].split(":")[0].replace(/\D/g, "");
    if (!lidBase) return;
    if (!lidPhoneMap.has(sessionKey)) lidPhoneMap.set(sessionKey, new Map());
    const map = lidPhoneMap.get(sessionKey);
    if (map.get(lidBase) === digits) return; // já sabido, evita I/O à toa
    map.set(lidBase, digits);
    console.log(`[WA] Telefone ${digits} atrelado ao LID ${lidBase}`);
    saveLidMap(sessionKey);
  } catch {}
}

const TZ_SP = "America/Sao_Paulo";

function renderRejectMessage(template, fromJid) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ_SP, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);

  const p = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;

  const hour = Number(p.hour);
  const saudacao = hour >= 4 && hour < 12 ? "Bom dia" : hour >= 12 && hour < 18 ? "Boa tarde" : "Boa noite";
  const hora = `${p.hour}:${p.minute}`;
  const data = `${p.day}/${p.month}/${p.year}`;
  const numero = fromJid.replace("@s.whatsapp.net", "").replace(/\D/g, "");

  return template
    .replace(/\{SAUDACAO\}/gi, saudacao)
    .replace(/\{HORA\}/gi, hora)
    .replace(/\{DATA\}/gi, data)
    .replace(/\{NUMERO\}/gi, numero);
}

// ✅ 05/09/2026, pedido do Márcio: precisamos enxergar quando o CELULAR DO
// CLIENTE pede reenvio por não conseguir decifrar uma mensagem que
// mandamos ("recv retry request", debug interno do Baileys) — hoje esse
// sinal existe mas é 100% ignorado (logger silencioso). Em vez de deixar o
// Baileys solto em nível debug (ele é MUITO verboso, motivo original do
// "silent"), o destino customizado abaixo intercepta cada linha, conta só
// o que interessa e nunca escreve nada solto no stdout — sem reintroduzir
// o spam.
let decryptRetryCount = 0;
const baileysLogStream = new Writable({
  write(chunk, _enc, cb) {
    try {
      const line = JSON.parse(chunk.toString());
      if (line?.msg === "recv retry request") decryptRetryCount++;
    } catch {}
    cb();
  },
});
const baileysLogger = pino({ level: "debug" }, baileysLogStream);

setInterval(() => {
  if (decryptRetryCount > 0) {
    console.log(`[WA][SESSION_HEALTH] ${decryptRetryCount} pedido(s) de reenvio por falha de decriptação (recv retry request) nos últimos 5 min`);
    decryptRetryCount = 0;
  }
}, 5 * 60 * 1000);

// Map de sessões ativas: sessionKey -> { socket, qr, status, retries }
const sessions = new Map();

// Map lid -> phone: sessionKey -> Map(lid -> phoneNumber)
const lidPhoneMap = new Map();

// Callbacks de QR por sessão: sessionKey -> fn(qr)
const qrCallbacks = new Map();

function getSessionDir(sessionKey) {
  return path.join(AUTH_DIR, sessionKey);
}

function ensureAuthDir(sessionKey) {
  const dir = getSessionDir(sessionKey);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSession(sessionKey) {
  return sessions.get(sessionKey) || null;
}

function getAllSessions() {
  const result = [];
  for (const [key, sess] of sessions.entries()) {
    result.push({
      sessionKey: key,
      status: sess.status,
      jid: sess.jid || null,
      pushName: sess.pushName || null,
    });
  }
  return result;
}

async function createSession(sessionKey) {
  // Evita criar duplicata
  const existing = sessions.get(sessionKey);
  if (existing && existing.status === "connected") return existing;

  const sessionDir = ensureAuthDir(sessionKey);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

const sessData = {
    socket: null,
    qr: null,
    status: "connecting", // connecting | qr | connected | disconnected
    jid: null,
    pushName: null,
    pictureUrl: null,
    retries: 0,
    qrTimeout: null, 
    nameTracker: null, // ✅ NOVO: Guarda o ID do rastreador para podermos matá-lo
  };
  sessions.set(sessionKey, sessData);

  // ✅ NOVO: Lixeiro Automático (5 minutos)
  // Se a pessoa não escanear o QR Code em 5 min, destrói a sessão para liberar memória
  sessData.qrTimeout = setTimeout(async () => {
    const current = sessions.get(sessionKey);
    if (current && current.status !== "connected") {
      console.log(`[WA][${sessionKey.slice(0, 8)}] ⏳ Timeout (5 min). Ninguém escaneou o QR Code. Destruindo lixo...`);
      await disconnectSession(sessionKey); // Usa sua própria função para limpar a pasta e a memória
    }
  }, 5 * 60 * 1000); // 5 minutos em milissegundos

const sock = makeWASocket({
    version,
    auth: state,
    logger: baileysLogger,
    printQRInTerminal: false,
    // ✅ Fingerprint do "aparelho vinculado" (pedido do Márcio, 01/08/2026) —
    // NÃO usa Browsers.windows()/.macOS() daqui da lib: esses presets são
    // strings fixas, idênticas pra todo mundo que usa Baileys sem
    // customizar, e por isso reconhecíveis em massa por antifraude. Esse
    // array customizado (Mac OS + Chrome + versão real, mas não é preset de
    // ninguém) tem o mesmo formato de uma sessão genuína, sem ser cópia do
    // valor padrão da biblioteca. ✅ 05/09/2026: versão do Chrome não é mais
    // fixa — `currentChromeVersion` se atualiza sozinho 1x/dia (ver topo do
    // arquivo), então cada nova conexão já nasce com a versão atual.
    browser: ["Mac OS", "Chrome", currentChromeVersion],

    // ✅ Proxy residencial (ver comentário no topo do arquivo) — sai por IP
    // brasileiro em vez do IP de datacenter da VM. `agent` é o socket
    // WebSocket em si, `fetchAgent` é upload/download de mídia.
    ...(WA_PROXY_URL
      ? { agent: new HttpsProxyAgent(WA_PROXY_URL), fetchAgent: new HttpsProxyAgent(WA_PROXY_URL) }
      : {}),

// ✅ CONFIGURAÇÕES DE SAAS (Alta Tolerância)
    connectTimeoutMs: 60_000,        
    defaultQueryTimeoutMs: 60_000,   
    // ✅ 05/09/2026, pedido do Márcio: reduzido de 30s pra 15s — se um "Alô?"
    // falhar (proxy/rede engasgar por um instante), ainda sobra margem pro
    // próximo antes da WhatsApp considerar o túnel morto.
    keepAliveIntervalMs: 15_000,     // ✅ Manda o "Alô?" a cada 15s para manter o túnel aceso
    retryRequestDelayMs: 5_000,
    
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true, // Garante envio de links mais bonitos
    
    // ✅ PREVENÇÃO CONTRA "Aguardando mensagem..."
    maxMsgRetryCount: 15,
    getMessage: async (key) => {
      // Retorna vazio apenas para acionar o gatilho interno do Baileys
      // que força o celular a reenviar as chaves de descriptografia.
      return { conversation: "" };
    },
  });

sessData.socket = sock;

  // carrega mapa lid→phone salvo no disco
  loadLidMap(sessionKey);

  // ── Credenciais ──────────────────────────────────────────────
  sock.ev.on("creds.update", saveCreds);

  function mapContacts(contacts) {
  if (!lidPhoneMap.has(sessionKey)) lidPhoneMap.set(sessionKey, new Map());
  const map = lidPhoneMap.get(sessionKey);
  for (const contact of contacts) {
    if (contact.lid && contact.id) {
      const phone = contact.id.split("@")[0].split(":")[0].replace(/\D/g, "");
      const lid = contact.lid.split("@")[0].split(":")[0];
      if (phone && lid) map.set(lid, phone);
    }
  }
}

sock.ev.on("contacts.upsert", (contacts) => {
  mapContacts(contacts);
  saveLidMap(sessionKey);
});
sock.ev.on("contacts.set", ({ contacts }) => { mapContacts(contacts); saveLidMap(sessionKey); });

// Captura lid->phone nas mensagens também (constrói o mapa com o tempo)
// ⚠️ Adicionado `type` para filtrar apenas mensagens novas (notify) no bot
sock.ev.on("messages.upsert", ({ messages, type }) => {
  // ════════════════════════════════════════════════════════════════
  // PARTE 1 — EXISTENTE: constrói mapa lid→phone (síncrono, preservado)
  // ════════════════════════════════════════════════════════════════
  if (!lidPhoneMap.has(sessionKey)) lidPhoneMap.set(sessionKey, new Map());
  const map = lidPhoneMap.get(sessionKey);
  let changed = false;
  for (const msg of messages) {
    const key = msg.key;
    if (!key) continue;
    const jid = key.remoteJid || "";
    const lid = key.participant || key.remoteJid || "";
    if (jid.includes("@s.whatsapp.net") && lid.includes("@lid")) {
      const phone = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
      const lidKey = lid.split("@")[0].split(":")[0];
      if (phone && lidKey) { map.set(lidKey, phone); changed = true; }
    }
  }
  if (changed) saveLidMap(sessionKey);
});

  // ── Conexão ──────────────────────────────────────────────────
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR gerado
    if (qr) {
      sessData.qr = qr;
      sessData.status = "qr";
      console.log(`[WA][${sessionKey.slice(0, 8)}] QR pronto`);

      const cb = qrCallbacks.get(sessionKey);
      if (cb) cb(qr);
    }

if (connection === "open") {
      // ✅ Desarma o lixeiro automático, pois o usuário conectou com sucesso!
      if (sessData.qrTimeout) {
        clearTimeout(sessData.qrTimeout);
        sessData.qrTimeout = null;
      }

      sessData.status = "connected";
      sessData.qr = null;
      sessData.retries = 0;
      
      const rawJid = sock.user?.id || "";
      const cleanPhone = rawJid.split(":")[0].split("@")[0];
      sessData.jid = rawJid || null;

      // Nome provisório: Tenta o nome imediato, se não tiver, usa o número para a UI não travar
      sessData.pushName = sock.user?.name || (cleanPhone ? `+${cleanPhone}` : "Sem Nome");
      console.log(`[WA][${sessionKey.slice(0, 8)}] ✅ Conectado: ${sessData.pushName}`);

     // Tenta buscar foto de perfil
      try {
        if (sessData.jid) {
          sessData.pictureUrl = await sock.profilePictureUrl(sessData.jid, "image").catch(() => null);
        }
      } catch {}

      // ✅ Começa "indisponível" ao conectar (pedido original do Márcio: sem
      // isso, o WhatsApp exibe "online" 24h enquanto a sessão estiver
      // conectada). AJUSTADO 26/07/2026: ficar 100% offline o tempo todo,
      // inclusive quando manda várias mensagens, não é natural — ninguém usa
      // WhatsApp assim. Agora fica só "indisponível" em repouso; sendMessage()
      // liga "disponível" durante o envio e agenda a volta pra "indisponível"
      // sozinho depois de alguns segundos (ver goOnlineForSend/scheduleGoOffline).
      sock.sendPresenceUpdate("unavailable").catch(() => {});

      // ✅ 05/09/2026: agenda a próxima janela de "ficar online sem estar
      // enviando nada" (ver runPresenceSim/scheduleNextPresenceSim) — imita
      // alguém abrindo o app de vez em quando.
      scheduleNextPresenceSim(sessData);

      // Rastreador persistente para capturar o nome real (Normal ou Business)
      // ✅ BLINDAGEM: Mata qualquer rastreador antigo antes de criar um novo
      if (sessData.nameTracker) {
        clearInterval(sessData.nameTracker);
      }

      let nameAttempts = 0;
      sessData.nameTracker = setInterval(async () => {
        nameAttempts++;
        const currentName = sock.user?.name; // Tenta capturar o nome do WhatsApp Normal

        if (currentName && currentName !== sessData.pushName && currentName !== `+${cleanPhone}`) {
          sessData.pushName = currentName;
          console.log(`[WA][${sessionKey.slice(0, 8)}] 📛 Nome capturado: ${currentName}`);
          clearInterval(sessData.nameTracker);
          return;
        }

        // Na 3ª tentativa (após ~15s), se ainda não tem nome normal, checa se é Business
        if (nameAttempts === 3 && sessData.jid && (!currentName || sessData.pushName === `+${cleanPhone}`)) {
          try {
            const bizProfile = await sock.getBusinessProfile(sessData.jid);
            if (bizProfile?.name) {
              sessData.pushName = bizProfile.name;
              console.log(`[WA][${sessionKey.slice(0, 8)}] 📛 Nome Business capturado: ${bizProfile.name}`);
              clearInterval(sessData.nameTracker);
              return;
            }
          } catch (e) {
            // Não é business ou falhou, ignora silenciosamente
          }
        }

        // Desiste após 10 tentativas (50 segundos)
        if (nameAttempts >= 10) {
          clearInterval(sessData.nameTracker);
        }
      }, 5000);
    }

    if (connection === "close") {
      // ✅ Esse listener pertence ao socket ANTIGO. Se sessions.get(sessionKey)
      // já não é mais esta sessData (por exemplo, reconnectSession() já
      // substituiu por uma sessão nova enquanto esse evento "close" ainda
      // estava a caminho), é um evento obsoleto — não agenda reconexão, quem
      // substituiu já está cuidando disso. Sem essa checagem, dois
      // createSession() concorrentes para a mesma sessionKey podiam brigar
      // pelo mesmo diretório de credenciais.
      if (sessions.get(sessionKey) !== sessData) {
        console.log(`[WA][${sessionKey.slice(0, 8)}] Evento de conexão obsoleto ignorado (sessão já substituída)`);
        return;
      }

      const statusCode = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : null;


      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut &&
        statusCode !== DisconnectReason.forbidden &&
        sessData.retries < 10;

      console.log(`[WA][${sessionKey.slice(0, 8)}] Desconectado (${statusCode}), reconectar: ${shouldReconnect}`);

      if (shouldReconnect) {
        sessData.status = "connecting";
        sessData.retries++;
        // ✅ Espera 10 segundos na primeira tentativa, até o limite de 30s nas próximas.
        // Isso impede que ele tente reconectar num loop desesperado que trava o Baileys.
        const delay = Math.min(sessData.retries * 10000, 30000);
        setTimeout(() => {
          // ✅ Checa de novo no momento de disparar — a sessão pode ter sido
          // substituída enquanto esse timer estava correndo.
          if (sessions.get(sessionKey) !== sessData) return;
          createSession(sessionKey);
        }, delay);
      } else {
        sessData.status = "disconnected";
        // Se foi logout, apaga credenciais
        if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.forbidden) {
  console.log(`[WA][${sessionKey.slice(0, 8)}] Logout detectado — removendo sessão`);
  deleteSessionFiles(sessionKey, true);
}
      }
    }
  });

  // ── Rejeição de Chamadas ─────────────────────────────────────
  sock.ev.on("call", async (calls) => {
    for (const call of calls) {
      if (call.status !== "offer") continue;

      // ✅ Deduplicação — ignora chamada já processada (evita replay na reconexão)
      if (isCallAlreadyProcessed(call.id)) {
        console.log(`[WA][${sessionKey.slice(0, 8)}] 🔁 Chamada ${call.id} já processada, ignorando`);
        continue;
      }

      const config = getSessionConfig(sessionKey);
      if (!config.rejectCalls) continue;

      // ✅ Resolve o JID real ANTES de qualquer operação
      let callerJid = call.from;
      let callerNumber = call.from.split("@")[0].split(":")[0].replace(/\D/g, "");

      if (call.from.includes("@lid")) {
        const map = lidPhoneMap.get(sessionKey);
        const resolvedPhone = map?.get(callerNumber);
        if (resolvedPhone) {
          callerNumber = resolvedPhone;
          callerJid = `${resolvedPhone}@s.whatsapp.net`;
          console.log(`[WA][CALL_DEBUG] LID ${call.from} → ${callerJid}`);
        } else {
          console.log(`[WA][CALL_DEBUG] LID ${call.from} não resolvido — usando JID original`);
        }
      }

      const allowed = (config.allowedNumbers || []).map(n => String(n).replace(/\D/g, ""));
      console.log(`[WA][CALL_DEBUG] from_raw=${call.from} callerNumber=${callerNumber} allowed=${JSON.stringify(allowed)}`);

      if (allowed.includes(callerNumber)) {
        console.log(`[WA][${sessionKey.slice(0, 8)}] ✅ Chamada permitida de ${callerNumber}`);
        continue;
      }

      // ✅ Rejeita primeiro — dispara o quanto antes, antes de qualquer outra
      // checagem/log, pra minimizar a corrida contra o toque nativo no celular
      // (que já começa a tocar assim que o WhatsApp empurra a notificação).
      try {
        // Rejeita usando o JID original (rejectCall precisa do JID exato que chegou)
        await sock.rejectCall(call.id, call.from);
        console.log(`[WA][${sessionKey.slice(0, 8)}] 📵 Chamada rejeitada de ${call.from}`);
      } catch (e) {
        console.error(`[WA][${sessionKey.slice(0, 8)}] Erro ao rejeitar chamada:`, e?.message);
        // ✅ Remove do cache se falhou — permite tentar novamente se reemitido
        processedCalls.delete(call.id);
        continue;
      }

      // ✅ Detecta se a chamada é de um grupo (Baileys expõe isGroup, e em
      // algumas versões também chatId/groupJid apontando para @g.us).
      // Log temporário para você confirmar no `docker logs` qual campo veio.
      const isGroupCall =
        call.isGroup === true ||
        (typeof call.chatId === "string" && call.chatId.endsWith("@g.us")) ||
        (typeof call.groupJid === "string" && call.groupJid.endsWith("@g.us"));

      // ✅ Chamada de grupo: já rejeitou e para por aqui — ninguém liga pro seu PV,
      // então não faz sentido mandar mensagem para o número que originou a chamada.
      if (isGroupCall) {
        console.log(`[WA][${sessionKey.slice(0, 8)}] 👥 Chamada em grupo detectada — raw call: ${JSON.stringify(call)}`);
        console.log(`[WA][${sessionKey.slice(0, 8)}] 🔇 Chamada de grupo — mensagem de rejeição NÃO enviada`);
        continue;
      }

      try {
        // ✅ Envia mensagem para o JID resolvido (número real, não LID) —
        // via sendMessage() (mesmo wrapper de todo o resto do sistema), não
        // mais sock.sendMessage() direto. Achado em auditoria (05/08/2026):
        // essa era a ÚNICA mensagem do sistema saindo sem a simulação de
        // "disponível"/"digitando..." — baixo volume, mas era um bypass real
        // da humanização aplicada em todo o resto dos envios.
        const renderedMessage = renderRejectMessage(config.rejectMessage, callerJid);
        await sendMessage(sessionKey, callerJid, renderedMessage);
        console.log(`[WA][${sessionKey.slice(0, 8)}] ✉️  Mensagem enviada para ${callerJid}`);
      } catch (e) {
        console.error(`[WA][${sessionKey.slice(0, 8)}] Erro ao enviar mensagem de rejeição:`, e?.message);
      }
    }
  });

  return sessData;
}

// ─────────────────────────────────────────────────────────────────────────────

// ✅ 01/09/2026, bug real achado: sess.socket.logout()/.end() (e também
// WebSocketClient.close() da própria Baileys) acabam chamando close()/
// terminate() no socket cru ('ws') — se ele ainda estiver no meio do
// handshake (isConnecting — ex: proxy lento/travado numa conexão que
// nunca termina de abrir), o PACOTE 'ws' aborta via
// `process.nextTick(emitErrorAndClose, ...)` (ws/lib/websocket.js,
// abortHandshake): um evento 'error' ASSÍNCRONO, não uma exceção síncrona
// — por isso o try/catch normal em volta do await NUNCA pegava (não é uma
// rejection da Promise, é um 'error' emitido depois, em outro tick) e
// virava uncaughtException no processo, abortando o resto da função de
// limpeza no meio do caminho — a sessão nunca terminava de ser derrubada
// direito, travando a próxima tentativa de gerar QR. terminate() tem
// exatamente o mesmo comportamento que close() nesse caso (mesmo trecho
// de código no pacote 'ws'), então trocar um pelo outro não resolve —
// o fix é garantir um listener de 'error' ANTES de abortar, pra esse
// evento assíncrono ter pra onde ir.
async function safeCloseSocket(sess) {
  const wrapper = sess?.socket?.ws; // instância WebSocketClient da Baileys
  if (!sess?.socket) return;

  const rawWs = wrapper?.socket; // socket cru ('ws') guardado dentro da wrapper
  if (rawWs && typeof rawWs.once === "function") {
    rawWs.once("error", () => {});
  }

  if (wrapper?.isOpen === true) {
    try {
      await sess.socket.logout();
    } catch {}
  }

  try {
    if (rawWs && typeof rawWs.terminate === "function") {
      rawWs.terminate();
    } else if (wrapper && typeof wrapper.close === "function") {
      wrapper.close();
    }
  } catch {}
}

async function disconnectSession(sessionKey) {
  const sess = sessions.get(sessionKey);
  if (!sess) return false;

  // ✅ Limpa os timers internos da sessão ANTES de derrubá-la — sem isso,
  // um nameTracker (setInterval a cada 5s) ou qrTimeout ainda em andamento
  // continuava rodando pra sempre em segundo plano, mesmo com a sessão já
  // removida do Map (a referência sobrevive no closure).
  if (sess.nameTracker) clearInterval(sess.nameTracker);
  if (sess.qrTimeout) clearTimeout(sess.qrTimeout);
  if (sess.presenceOfflineTimer) clearTimeout(sess.presenceOfflineTimer);

  await safeCloseSocket(sess);

  sess.status = "disconnected";
  sessions.delete(sessionKey);
  deleteSessionFiles(sessionKey);
  return true;
}

// ✅ Hard reset (pedido do Márcio, 26/07/2026) — diferente do disconnect
// normal (que preserva wa-config.json/lid-map.json/human-paused.json pra
// não perder configuração à toa), esse apaga a pasta INTEIRA da sessão, sem
// exceção nenhuma, e NÃO chama createSession() de novo — fica sem QR
// pendente, começando do zero de verdade. Usado quando reconectar (mesmo
// com QR novo) não resolveu e a suspeita é de sessão/credencial corrompida
// de um jeito que um disconnect parcial não limpa.
async function hardResetSession(sessionKey) {
  const sess = sessions.get(sessionKey);

  if (sess) {
    if (sess.nameTracker) clearInterval(sess.nameTracker);
    if (sess.qrTimeout) clearTimeout(sess.qrTimeout);
    if (sess.presenceOfflineTimer) clearTimeout(sess.presenceOfflineTimer);
    await safeCloseSocket(sess);
  }

  sessions.delete(sessionKey);
  deleteSessionFiles(sessionKey, true);
  return true;
}

async function reconnectSession(sessionKey) {
  const sess = sessions.get(sessionKey);

  if (sess) {
    // Mata o socket e os timers sem apagar nenhum arquivo
    if (sess.nameTracker) clearInterval(sess.nameTracker);
    if (sess.qrTimeout) clearTimeout(sess.qrTimeout);
    if (sess.presenceOfflineTimer) clearTimeout(sess.presenceOfflineTimer);
    await safeCloseSocket(sess);
    sessions.delete(sessionKey);
    console.log(`[WA][${sessionKey.slice(0, 8)}] 🔄 Sessão encerrada para reconexão`);
  }

  // Pequeno delay para o WhatsApp soltar a conexão antiga
  await new Promise(r => setTimeout(r, 2000));

  // Recria a sessão — credenciais no disco estão intactas
  return await createSession(sessionKey);
}

function deleteSessionFiles(sessionKey, fullDelete = false) {
  const dir = getSessionDir(sessionKey);
  if (!fs.existsSync(dir)) return;

  if (fullDelete) {
    // Logout real: apaga a pasta inteira para não reaparecer no restore
    fs.rmSync(dir, { recursive: true, force: true });
    sessions.delete(sessionKey);
    sessionConfigs.delete(sessionKey);
    lidPhoneMap.delete(sessionKey);
    console.log(`[WA][${sessionKey.slice(0, 8)}] Pasta de sessão removida completamente`);
    return;
  }

  // Disconnect simples: preserva config e lid-map
  const PRESERVE = new Set(["wa-config.json", "lid-map.json"]);
  for (const entry of fs.readdirSync(dir)) {
    if (PRESERVE.has(entry)) continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
  console.log(`[WA][${sessionKey.slice(0, 8)}] Arquivos de auth removidos (config preservada)`);
}

// ✅ Presença dinâmica (pedido do Márcio, 26/07/2026) — em repouso a sessão
// fica "indisponível" (ver connection.update acima), mas mandar mensagens
// 100% offline o tempo todo não é natural. Aqui ela liga "disponível" bem
// antes de enviar, e agenda a volta pra "indisponível" sozinha depois de um
// tempo sem NENHUM envio novo — imita alguém abrindo o WhatsApp, mandando
// uma ou várias mensagens, e fechando o app de novo. O timer é por SESSÃO
// (global, sem jid — mesmo padrão do "unavailable" inicial), então vários
// envios seguidos (ex: campanha de cobrança) mantêm "disponível" contínuo
// em vez de piscar online/offline a cada mensagem.
const ONLINE_BEFORE_SEND_MS = 3_000; // fica "disponível" um instante antes de mandar, como se tivesse acabado de abrir o app
const ONLINE_LINGER_MS = 12_000; // some tempos depois do ÚLTIMO envio, sem mensagem nova, antes de voltar a "indisponível"

// ✅ 05/09/2026: `scheduleGoOffline` agora respeita `presenceKeepOnlineUntil`
// — usado pela simulação de presença ociosa abaixo, pra um envio real no
// meio de uma janela "só ficando online, sem mandar nada" não cortar essa
// janela mais cedo (o timer normal de 12s do envio nunca antecipa o fim de
// uma janela simulada mais longa que já esteja em andamento).
function scheduleGoOffline(sess, minDelayMs = ONLINE_LINGER_MS) {
  const now = Date.now();
  const targetTs = Math.max(now + minDelayMs, sess.presenceKeepOnlineUntil || 0);
  if (sess.presenceOfflineTimer) clearTimeout(sess.presenceOfflineTimer);
  sess.presenceOfflineTimer = setTimeout(() => {
    try { sess.socket?.sendPresenceUpdate("unavailable"); } catch {}
  }, targetTs - now);
}

async function goOnlineForSend(sess) {
  // Já está com o timer de "ficar online" pendente (ou seja, já apareceu
  // disponível há pouco) — não precisa religar nem esperar de novo, só
  // adia a volta pro "indisponível".
  if (sess.presenceOfflineTimer) {
    clearTimeout(sess.presenceOfflineTimer);
    sess.presenceOfflineTimer = null;
    return;
  }
  try { sess.socket?.sendPresenceUpdate("available"); } catch {}
  await new Promise((r) => setTimeout(r, ONLINE_BEFORE_SEND_MS));
}

// ✅ 05/09/2026, pedido do Márcio: hoje a sessão só aparece "disponível"
// nos poucos segundos ao redor de um envio real — 100% correlacionado com
// mandar mensagem, o que também é um padrão reconhecível (gente de
// verdade abre o WhatsApp e fica online lendo/parada sem estar mandando
// nada). Simula alguém abrindo o app de vez em quando, sem relação com
// envio: em intervalos aleatórios (20-90 min) fica "disponível" por
// alguns minutos (2-8, também aleatório) e volta a "indisponível" sozinha
// — via `scheduleGoOffline` (mesmo mecanismo do envio real), então se uma
// mensagem de verdade for mandada no meio dessa janela, o timer de volta-
// pra-offline dela não encurta a janela simulada (ver comentário acima).
const PRESENCE_SIM_MIN_GAP_MS = 20 * 60 * 1000;
const PRESENCE_SIM_MAX_GAP_MS = 90 * 60 * 1000;
const PRESENCE_SIM_MIN_ONLINE_MS = 2 * 60 * 1000;
const PRESENCE_SIM_MAX_ONLINE_MS = 8 * 60 * 1000;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function scheduleNextPresenceSim(sess) {
  if (sess.presenceSimTimer) clearTimeout(sess.presenceSimTimer);
  sess.presenceSimTimer = setTimeout(
    () => runPresenceSim(sess),
    randomBetween(PRESENCE_SIM_MIN_GAP_MS, PRESENCE_SIM_MAX_GAP_MS),
  );
}

async function runPresenceSim(sess) {
  // ✅ Sessão caiu/foi substituída por uma reconexão nova enquanto o timer
  // corria — não faz nada e não reagenda (a sessão nova já agenda a dela
  // própria quando conectar).
  if (!sess.socket || sess.status !== "connected") return;

  const onlineMs = randomBetween(PRESENCE_SIM_MIN_ONLINE_MS, PRESENCE_SIM_MAX_ONLINE_MS);
  try {
    await sess.socket.sendPresenceUpdate("available").catch(() => {});
    sess.presenceKeepOnlineUntil = Date.now() + onlineMs;
    scheduleGoOffline(sess, onlineMs);
  } catch {}

  setTimeout(() => {
    if (sess.status === "connected") scheduleNextPresenceSim(sess);
  }, onlineMs);
}

// ✅ "Digitando..." antes de mandar (pedido do Márcio, 26/07/2026: "ninguém
// consegue enviar nada sem digitar"). Vale pra quem INICIA a conversa —
// cobrança automática — que hoje mandava instantâneo, sem nenhuma simulação.
// Tempo sorteado, não fixo — mesma filosofia anti-padrão-robótico já
// aplicada no intervalo da campanha de cobrança.
//
// ✅ 05/08/2026 — achado em auditoria pós-2ª restrição da Meta: tinha sido
// reduzido de 5-10s pra 0-2s em 04/08/2026 (véspera da restrição) por causa
// de duração/CPU da invocação da Vercel que dispara isso. Voltou pra um meio
// termo (2-5s, não os 5-10s originais) — o principal consumidor real do
// orçamento de `maxDuration=120` do envio_programado é o intervalo entre
// contato primário/secundário (`secondary_contact_delay_min/max_secs`, até
// 2min por padrão), não esse "digitando" — então dava pra devolver algum
// tempo aqui com folga de sobra. Se o timeout voltar a acontecer, mexer
// primeiro no intervalo de contato secundário, não aqui.
const TYPING_BEFORE_SEND_MIN_MS = 2_000;
const TYPING_BEFORE_SEND_MAX_MS = 5_000;

async function sendMessage(sessionKey, phone, message, imageUrl = null, opts = {}) {
  const sess = sessions.get(sessionKey);
  if (!sess || sess.status !== "connected") {
    throw new Error("Sessão não conectada");
  }

  // Normaliza número para WhatsApp
  const jid = normalizeJid(phone);

  await goOnlineForSend(sess);

  if (!opts.skipTypingSimulation) {
    const typingMs =
      TYPING_BEFORE_SEND_MIN_MS +
      Math.floor(Math.random() * (TYPING_BEFORE_SEND_MAX_MS - TYPING_BEFORE_SEND_MIN_MS + 1));
    try { sess.socket.sendPresenceUpdate("composing", jid); } catch {}
    await new Promise((r) => setTimeout(r, typingMs));
    try { sess.socket.sendPresenceUpdate("paused", jid); } catch {}
  }

  let result;

  // ✅ LÓGICA DO BAILEYS: Se tem imagem, manda como mídia. Se não, manda só texto.
  if (imageUrl) {
    result = await sess.socket.sendMessage(jid, {
      image: { url: imageUrl },
      caption: message
    });
  } else {
    result = await sess.socket.sendMessage(jid, {
      text: message
    });
  }

  scheduleGoOffline(sess);

  const messageId = result?.key?.id || null;

  return {
    ok: true,
    messageId,
  };
}

async function validateNumber(sessionKey, phone) {
  const sess = sessions.get(sessionKey);
  if (!sess || sess.status !== "connected") {
    throw new Error("Sessão não conectada para validar número");
  }

  const jid = normalizeJid(phone);
  const [result] = await sess.socket.onWhatsApp(jid);

  // Aproveita toda validação de número (cadastro de cliente, agenda, revenda,
  // perfil do admin) pra também alimentar o mapa lid→telefone — não muda em
  // nada a resposta desta função, só deixa a resolução de LID nas mensagens/
  // ligações recebidas mais completa com o tempo (ver rememberLidMapping).
  rememberLidMapping(sessionKey, String(phone).replace(/\D/g, ""), result?.lid);

  return {
    phone,
    exists: !!result?.exists,
    jid: result?.jid || null,
  };
}

function normalizeJid(phone) {
  // Remove tudo que não for dígito
  const digits = String(phone).replace(/\D/g, "");

  // Já tem código de país (começa com 55 para Brasil)
  // Monta o JID padrão do WhatsApp
  return `${digits}@s.whatsapp.net`;
}

// ── Auto-reconectar sessões existentes no disco ───────────────
async function restoreExistingSessions() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    return;
  }

  const dirs = fs.readdirSync(AUTH_DIR).filter((d) => {
    return d !== "_config" && fs.statSync(path.join(AUTH_DIR, d)).isDirectory();
  });

  console.log(`[WA] Restaurando ${dirs.length} sessão(ões) existente(s)...`);

  for (const sessionKey of dirs) {
    try {
      await createSession(sessionKey);
      // Pequeno delay entre sessões para não sobrecarregar
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.error(`[WA] Erro ao restaurar sessão ${sessionKey.slice(0, 8)}:`, e?.message);
    }
  }
}

// Adiciona função nova antes dos exports:
async function getContactProfilePicture(sessionKey, jid) {
  const sess = sessions.get(sessionKey);
  if (!sess || sess.status !== "connected") {
    throw new Error("Sessão não conectada");
  }
  try {
    const url = await sess.socket.profilePictureUrl(jid, "image");
    return { url };
  } catch (e) {
    // Foto privada ou não existe
    return { url: null };
  }
}

export {
  createSession, disconnectSession, reconnectSession, hardResetSession, sendMessage, validateNumber,
  getSession, getAllSessions, restoreExistingSessions, qrCallbacks,
  getSessionConfig, updateSessionConfig, renderRejectMessage, getContactProfilePicture,
};

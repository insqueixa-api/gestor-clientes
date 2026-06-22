import makeWASocket, {
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

// Adiciona no topo do arquivo, após os imports:
const processedCalls = new Map(); // callId -> timestamp

// Human takeover: quando você responde, bot para por 4h pra aquele contato
// Map: sessionKey -> Map(phone -> pausedUntil timestamp)
// Em memória: se o servidor reiniciar, pausas somem — comportamento aceitável
const humanPausedContacts = new Map();

// Deduplicação de mensagens — evita processar a mesma msg duplicada do Baileys
const processedMessages = new Map(); // msgId -> timestamp
function isMessageAlreadyProcessed(msgId) {
  const now = Date.now();
  for (const [id, ts] of processedMessages.entries()) {
    if (now - ts > 60_000) processedMessages.delete(id); // limpa após 1 min
  }
  if (processedMessages.has(msgId)) return true;
  processedMessages.set(msgId, now);
  return false;
}

function isContactPaused(sessionKey, phone) {
  const map = humanPausedContacts.get(sessionKey);
  if (!map) return false;
  const until = map.get(phone);
  if (!until) return false;
  if (Date.now() > until) {
    map.delete(phone); // expirou, limpa
    return false;
  }
  return true;
}

function pauseContact(sessionKey, phone) {
  if (!humanPausedContacts.has(sessionKey)) {
    humanPausedContacts.set(sessionKey, new Map());
  }
  const until = Date.now() + 4 * 60 * 60 * 1000; // 4 horas
  humanPausedContacts.get(sessionKey).set(phone, until);
  console.log(`[BOT][${sessionKey.slice(0, 8)}] ⏸️ Atendimento humano ativo para ${phone} até ${new Date(until).toLocaleTimeString("pt-BR")}`);
}

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
    botEnabled: false,   // bot começa desligado — você liga pelo toggle no front
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
    ...(updates.botEnabled !== undefined ? { botEnabled: !!updates.botEnabled } : {}),
    ...(updates.tenantId !== undefined ? { tenantId: String(updates.tenantId) } : {}),
  };
  sessionConfigs.set(sessionKey, next);

  // Quando salvar números permitidos, resolve os lids via socket e salva no mapa
  if (Array.isArray(updates.allowedNumbers) && updates.allowedNumbers.length > 0) {
    const sess = sessions.get(sessionKey);
    if (sess?.socket && sess.status === "connected") {
      (async () => {
        if (!lidPhoneMap.has(sessionKey)) lidPhoneMap.set(sessionKey, new Map());
        const map = lidPhoneMap.get(sessionKey);
        for (const num of updates.allowedNumbers) {
          const digits = String(num).replace(/\D/g, "");
          if (!digits) continue;
          try {
            // Pede à API do WhatsApp as informações do número
            const [info] = await sess.socket.onWhatsApp(`${digits}@s.whatsapp.net`).catch(() => [null]);
            
            // PULO DO GATO: Pega o LID (Identidade Fantasma) e não o JID (Telefone)
            if (info && info.lid) {
              const lidBase = String(info.lid).split("@")[0].split(":")[0].replace(/\D/g, "");
              map.set(lidBase, digits);
              console.log(`[WA] Sucesso: Telefone ${digits} atrelado ao LID Fantasma ${lidBase}`);
            }
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

// logger silencioso para Baileys (evita spam nos logs)
const baileysLogger = pino({ level: "silent" });

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
    browser: ["UniGestor", "Chrome", "120.0.0"],
    
// ✅ CONFIGURAÇÕES DE SAAS (Alta Tolerância)
    connectTimeoutMs: 60_000,        
    defaultQueryTimeoutMs: 60_000,   
    keepAliveIntervalMs: 30_000,     // ✅ Manda o "Alô?" a cada 30s para manter o túnel aceso
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
  console.log(`[WA][CONTACTS] upsert ${contacts.length} contatos`);
  contacts.forEach(c => { if (c.lid) console.log(`[WA][CONTACTS] id=${c.id} lid=${c.lid}`); });
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

  // ════════════════════════════════════════════════════════════════
  // PARTE 2 — NOVO: lógica do bot (assíncrona, fire-and-forget)
  // Só processa mensagens novas (type="notify"), nunca histórico
  // ════════════════════════════════════════════════════════════════
if (type !== "notify") return;

  handleBotLogic(sessionKey, messages).catch(e =>
    console.error(`[BOT][${sessionKey.slice(0, 8)}] Erro no handler:`, e?.message)
  );
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

      // ✅ Aparece como offline para os contatos mesmo com socket ativo
      // Sem isso, o WhatsApp exibe "online" 24h enquanto a sessão estiver conectada
      sock.sendPresenceUpdate("unavailable").catch(() => {});

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
      const statusCode = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : null;

// ✅ NOVO: Aceita mais tentativas antes de jogar a toalha (aumentado para 10)
      // ✅ NOVO: Aceita mais tentativas antes de jogar a toalha (aumentado para 10)
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
        setTimeout(() => createSession(sessionKey), delay);
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

      try {
        // Rejeita usando o JID original (rejectCall precisa do JID exato que chegou)
        await sock.rejectCall(call.id, call.from);
        console.log(`[WA][${sessionKey.slice(0, 8)}] 📵 Chamada rejeitada de ${call.from}`);

        // ✅ Envia mensagem para o JID resolvido (número real, não LID)
        const renderedMessage = renderRejectMessage(config.rejectMessage, callerJid);
        await sock.sendMessage(callerJid, { text: renderedMessage });
        console.log(`[WA][${sessionKey.slice(0, 8)}] ✉️  Mensagem enviada para ${callerJid}`);
      } catch (e) {
        console.error(`[WA][${sessionKey.slice(0, 8)}] Erro ao rejeitar chamada:`, e?.message);
        // ✅ Remove do cache se falhou — permite tentar novamente se reemitido
        processedCalls.delete(call.id);
      }
    }
  });
  return sessData;
}

// ── Bot Logic Handler ─────────────────────────────────────────────────────────
async function handleBotLogic(sessionKey, messages) {
  const config = getSessionConfig(sessionKey);
  const lidMap = lidPhoneMap.get(sessionKey);

  for (const msg of messages) {
    const key = msg.key;
    if (!key) continue;

    const remoteJid = key.remoteJid || "";

    // Ignora grupos — sempre
    if (remoteJid.endsWith("@g.us")) continue;

    // Ignora status broadcast
    if (remoteJid === "status@broadcast") continue;

    // Ignora mensagens sem conteúdo (notificações internas do Baileys)
    if (!msg.message) continue;

    // Ignora reactions, view-once, e outros tipos sem conteúdo real pra bot
    const msgContent = msg.message;
    const isReaction = !!msgContent.reactionMessage;
    const isProtocol = !!msgContent.protocolMessage;
    const isEphemeral = !!msgContent.ephemeralMessage;
    if (isReaction || isProtocol || isEphemeral) continue;

    // ── Resolve telefone do remetente ──────────────────────────
    let phone = remoteJid.split("@")[0].split(":")[0].replace(/\D/g, "");

    if (remoteJid.includes("@lid")) {
      // LID (identidade fantasma) — tenta resolver para número real
      const resolved = lidMap?.get(phone);
      if (!resolved) {
        console.log(`[BOT][${sessionKey.slice(0, 8)}] LID não resolvido ainda, ignorando`);
        continue;
      }
      phone = resolved;
    }

    if (!phone || phone.length < 8) continue;

    // ── fromMe: você respondeu → human takeover ────────────────
    if (key.fromMe) {
      pauseContact(sessionKey, phone);
      continue;
    }

    // ── Mensagem recebida de cliente ───────────────────────────

// Bot desligado pelo toggle do painel
    if (!config.botEnabled) continue;

    // Contato em pausa (você assumiu o atendimento)
    if (isContactPaused(sessionKey, phone)) {
      console.log(`[BOT][${sessionKey.slice(0, 8)}] ⏸️ ${phone} em atendimento humano, bot silencioso`);
      continue;
    }

    // Tem conteúdo que vale processar?
    const hasText = !!(
      msgContent.conversation ||
      msgContent.extendedTextMessage?.text
    );
    const hasMedia = !!(
      msgContent.imageMessage ||
      msgContent.documentMessage
    );

if (!hasText && !hasMedia) continue;

// Deduplicação — Baileys pode emitir a mesma mensagem várias vezes
    const msgId = msg.key?.id;
    if (msgId && isMessageAlreadyProcessed(msgId)) {
      console.log(`[BOT][${sessionKey.slice(0, 8)}] Msg ${msgId} já processada, ignorando duplicata`);
      continue;
    }

    // Chama o agente de IA (fire-and-forget com log de erro)
    callBotAgent(sessionKey, phone, msg).catch(e =>
      console.error(`[BOT][${sessionKey.slice(0, 8)}] Erro ao chamar agente para ${phone}:`, e?.message)
    );
  }
}

// ── Bot Agent ─────────────────────────────────────────────────────────────────
// Baixa imagem/documento do Baileys e converte para base64 (necessário para
// análise de comprovante — o bot não tem acesso ao socket diretamente)
async function downloadMsgMedia(sock, msg) {
  try {
    const buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: baileysLogger, reuploadRequest: sock.updateMediaMessage },
    );
    return Buffer.from(buffer).toString("base64");
  } catch (e) {
    console.error(`[BOT] Erro ao baixar mídia:`, e?.message);
    return null;
  }
}

// Chama o agente de IA no Next.js — fire-and-forget com tratamento de erro
async function callBotAgent(sessionKey, phone, msg) {
  const config = getSessionConfig(sessionKey);

  if (!config.tenantId) {
    console.warn(`[BOT][${sessionKey.slice(0, 8)}] tenantId não configurado — salve as configurações do WhatsApp no painel`);
    return;
  }

  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  const botSecret = String(process.env.UNIGESTOR_BOT_INTERNAL_SECRET || "").trim();

  if (!appUrl || !botSecret) {
    console.warn(`[BOT] UNIGESTOR_APP_URL ou UNIGESTOR_BOT_INTERNAL_SECRET não configurados`);
    return;
  }

  // Extrai texto da mensagem
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    null;

  // Detecta tipo de mídia
  const hasImage = !!(msg.message?.imageMessage);
  const hasDocument = !!(msg.message?.documentMessage);
  const hasMidia = hasImage || hasDocument;

  // Baixa mídia se necessário (para leitura de comprovante)
  let mediaBase64 = null;
  let mediaType = null;

  if (hasMidia) {
    const sess = sessions.get(sessionKey);
    if (sess?.socket) {
      mediaBase64 = await downloadMsgMedia(sess.socket, msg);
      mediaType = hasImage ? "image" : "document";
    }
  }

  // Nada útil pra processar
  if (!text && !mediaBase64) return;

  const payload = {
    tenant_id: config.tenantId,
    session_key: sessionKey,
    phone,
    message_id: msg.key?.id || null,
    text,
    media_base64: mediaBase64,
    media_type: mediaType,
    mime_type: hasImage
      ? (msg.message?.imageMessage?.mimetype || "image/jpeg")
      : (msg.message?.documentMessage?.mimetype || null),
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000); // 30s — agente pode demorar
    let res;
    try {
      res = await fetch(`${appUrl}/api/whatsapp/bot/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": botSecret,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[BOT][${sessionKey.slice(0, 8)}] Agente retornou erro ${res.status}: ${err.slice(0, 200)}`);
    } else {
      console.log(`[BOT][${sessionKey.slice(0, 8)}] ✅ Agente processou mensagem de ${phone}`);
    }
  } catch (e) {
    if (e?.name === "AbortError") {
      console.error(`[BOT][${sessionKey.slice(0, 8)}] Timeout ao chamar agente`);
    } else {
      console.error(`[BOT][${sessionKey.slice(0, 8)}] Erro ao chamar agente:`, e?.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function disconnectSession(sessionKey) {
  const sess = sessions.get(sessionKey);
  if (!sess) return false;

  try {
    await sess.socket?.logout();
  } catch {}

  sess.status = "disconnected";
  sessions.delete(sessionKey);
  deleteSessionFiles(sessionKey);
  return true;
}

async function reconnectSession(sessionKey) {
  const sess = sessions.get(sessionKey);

  if (sess) {
    // Mata o socket e os timers sem apagar nenhum arquivo
    if (sess.nameTracker) clearInterval(sess.nameTracker);
    if (sess.qrTimeout) clearTimeout(sess.qrTimeout);
    try { sess.socket?.end(); } catch {}
    try { sess.socket?.ws?.close(); } catch {}
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

// ✅ AGORA RECEBE O imageUrl COMO TERCEIRO PARÂMETRO (OPCIONAL)
async function sendMessage(sessionKey, phone, message, imageUrl = null) {
  const sess = sessions.get(sessionKey);
  if (!sess || sess.status !== "connected") {
    throw new Error("Sessão não conectada");
  }

  // Normaliza número para JID do WhatsApp
  const jid = normalizeJid(phone);

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

  return {
    ok: true,
    messageId: result?.key?.id || null,
  };
}

async function validateNumber(sessionKey, phone) {
  const sess = sessions.get(sessionKey);
  if (!sess || sess.status !== "connected") {
    throw new Error("Sessão não conectada para validar número");
  }

  const jid = normalizeJid(phone);
  const [result] = await sess.socket.onWhatsApp(jid);

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
  createSession, disconnectSession, reconnectSession, sendMessage, validateNumber,
  getSession, getAllSessions, restoreExistingSessions, qrCallbacks,
  getSessionConfig, updateSessionConfig, renderRejectMessage, getContactProfilePicture,
};

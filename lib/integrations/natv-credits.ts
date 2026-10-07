// lib/integrations/natv-credits.ts
// ✅ 06/10/2026: envio de crédito pra revenda pela API do NaTV
// (https://revenda.pixbot.link/openapi.json).
//
// Regras da documentação (todas tratadas aqui):
// - POST /reseller/credits só envia pra sub-revenda DIRETA (ou pro master);
//   mínimo 5 créditos (4 se o destino tiver exatamente 1); 3 chamadas/5s e
//   10/min; global 1 chamada a cada 150ms.
// - NÃO existe chave de idempotência nem como retirar crédito: um envio em
//   dobro não tem volta. Por isso NUNCA repetimos a chamada de envio
//   automaticamente — quem decide é app/api/integrations/natv/transfer-credits
//   (trava no banco + conferência de saldo antes e depois).

export const NATV_BASE = "https://revenda.pixbot.link";

export type NatvSubreseller = {
  id: number;
  username: string;
  credits: number;
  status: number;
};

export type NatvTransferResult =
  // resposta 200 do NaTV
  | { kind: "ok"; status: number; body: any }
  // NaTV respondeu e recusou (400/402/404/422…): crédito NÃO saiu
  | { kind: "rejected"; status: number; body: any; message: string }
  // sem resposta confiável (timeout, rede, 5xx): crédito PODE ter saído
  | { kind: "uncertain"; status: number | null; body: any; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function detailOf(body: any): string {
  const d = body?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg);
  return "";
}

/** Mínimo exigido pelo NaTV pra esse destinatário. */
export function natvMinTransfer(recipientCredits: number | null | undefined): number {
  return Number(recipientCredits) === 1 ? 4 : 5;
}

/** Sub-revenda direta pelo login EXATO (a busca do NaTV é por "parte do nome"). */
export async function natvFindSubreseller(token: string, username: string): Promise<NatvSubreseller | null> {
  const res = await fetch(`${NATV_BASE}/reseller/subreseller/search`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ username }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(detailOf(body) || `NaTV respondeu ${res.status} ao buscar a sub-revenda.`);
  }
  const list = Array.isArray(body) ? body : [];
  const wanted = username.trim().toLowerCase();
  const hit = list.find((s: any) => String(s?.username || "").trim().toLowerCase() === wanted);
  if (!hit) return null;
  return {
    id: Number(hit.id),
    username: String(hit.username),
    credits: Number(hit.credits),
    status: Number(hit.status),
  };
}

/** Saldo da SUA conta no NaTV (GET /reseller/me). */
export async function natvMyCredits(token: string): Promise<number> {
  const res = await fetch(`${NATV_BASE}/reseller/me`, {
    method: "GET",
    headers: headers(token),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(detailOf(body) || `NaTV respondeu ${res.status} ao consultar o saldo.`);
  }
  const n = Number(body?.credits);
  if (!Number.isFinite(n)) throw new Error("NaTV não informou o saldo.");
  return n;
}

/** UMA chamada de envio — nunca repete. */
export async function natvTransferCredits(token: string, username: string, amount: number): Promise<NatvTransferResult> {
  // respeita o intervalo global de 150ms depois das consultas de antes
  await sleep(200);
  let res: Response;
  try {
    res = await fetch(`${NATV_BASE}/reseller/credits`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ username, amount }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (e: any) {
    const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    return {
      kind: "uncertain",
      status: null,
      body: null,
      message: timeout ? "O NaTV não respondeu a tempo." : `Falha de rede ao falar com o NaTV (${e?.message || "erro"}).`,
    };
  }
  const body = await res.json().catch(() => null);
  if (res.ok) return { kind: "ok", status: res.status, body };
  if (res.status >= 500) {
    return { kind: "uncertain", status: res.status, body, message: detailOf(body) || `NaTV respondeu ${res.status}.` };
  }
  return {
    kind: "rejected",
    status: res.status,
    body,
    message:
      detailOf(body) ||
      (res.status === 429
        ? "Limite de envios do NaTV atingido — aguarde 1 minuto e tente de novo."
        : res.status === 401 || res.status === 403
        ? "A chave da API do NaTV não tem permissão pra enviar créditos (habilite no painel do NaTV)."
        : `NaTV recusou o envio (HTTP ${res.status}).`),
  };
}

// ---------------------------------------------------------------------------
// Relatório de clientes (GET /report/allusers — 1 chamada por minuto).
// Vem com TODOS os clientes da sua conta e das sub-revendas ("r" = revenda
// dona). Traz senha ("p") — só o espelho reseller_end_clients guarda (pra
// montar o M3U no servidor); nunca vai pro navegador. (/user/search NÃO acha
// cliente de sub-revenda — testado 07/10/2026 — por isso a senha vem daqui.)
export type NatvReportUser = {
  id: string | null;
  username: string;
  /** ✅ 07/10/2026: só pro espelho reseller_end_clients (servidor, nunca vai pro navegador) */
  password: string;
  reseller: string;
  expiresAt: string | null; // texto do NaTV "AAAA-MM-DD HH:MM:SS"
  status: string; // "Ativo" | "Expirado" | …
  blocked: boolean;
  connections: number;
};

export async function natvAllUsersReport(token: string): Promise<NatvReportUser[]> {
  const res = await fetch(`${NATV_BASE}/report/allusers`, {
    method: "GET",
    headers: headers(token),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      res.status === 429
        ? "O NaTV só libera esse relatório 1 vez por minuto — tente de novo em instantes."
        : detailOf(body) || `NaTV respondeu ${res.status} ao gerar o relatório de clientes.`,
    );
  }
  return (Array.isArray(body) ? body : []).map((u: any) => ({
    id: u?.i != null ? String(u.i) : null,
    username: String(u?.u ?? ""),
    password: String(u?.p ?? ""),
    reseller: String(u?.r ?? ""),
    expiresAt: u?.e ? String(u.e) : null,
    status: String(u?.t ?? ""),
    blocked: String(u?.b ?? "").toLowerCase() === "yes",
    connections: Number(u?.c) || 0,
  }));
}


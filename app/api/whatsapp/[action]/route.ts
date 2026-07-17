// app/api/whatsapp/[action]/route.ts
// Consolida as rotas de sessão WhatsApp (config, disconnect, qr, reconnect, status, profile),
// cada uma disponível para a Sessão 1 (ex: "qr") e Sessão 2 (ex: "qr2").
import { NextResponse } from "next/server";
import { getWAContext, getWAContextOrCron, proxyVM, errAuth } from "@/lib/whatsapp/wa-context";
import type { SessionNumber } from "@/lib/whatsapp/wa-context";

export const dynamic = "force-dynamic";

const BASE_ACTIONS = ["config", "disconnect", "qr", "reconnect", "status", "profile"] as const;
type BaseAction = (typeof BASE_ACTIONS)[number];

function parseAction(raw: string): { base: BaseAction; session: SessionNumber } | null {
  if ((BASE_ACTIONS as readonly string[]).includes(raw)) {
    return { base: raw as BaseAction, session: 1 };
  }
  if (raw.endsWith("2")) {
    const base = raw.slice(0, -1);
    if ((BASE_ACTIONS as readonly string[]).includes(base)) {
      return { base: base as BaseAction, session: 2 };
    }
  }
  return null;
}

function abortSafe(e: any) {
  return NextResponse.json(
    { error: e?.name === "AbortError" ? "Timeout" : e?.message },
    { status: 500 },
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const parsed = parseAction((await params).action);
  if (!parsed) return NextResponse.json({ error: "Rota inválida" }, { status: 404 });
  const { base, session } = parsed;

  if (base === "disconnect" || base === "reconnect") {
    return NextResponse.json({ error: "Método não permitido" }, { status: 405 });
  }

  const ctx = await getWAContext(session);
  if (!ctx) return errAuth();

  try {
    if (base === "config") {
      const { status, json } = await proxyVM(ctx, "/session-config");
      return NextResponse.json(json, { status });
    }

    if (base === "qr") {
      const { ok, status, json } = await proxyVM(ctx, "/qr");
      if (!ok) return NextResponse.json({ error: json?.error || "Falha" }, { status });
      return NextResponse.json({ qr: json.qr ?? null, connected: !!json.connected, status: json.status ?? null });
    }

    if (base === "status") {
      const { ok, status, json } = await proxyVM(ctx, "/status");
      if (!ok) return NextResponse.json({ error: json?.error || "Falha" }, { status });
      return NextResponse.json({ connected: !!json.connected, status: json.status ?? null });
    }

    // profile
    const { ok, status, json } = await proxyVM(ctx, "/profile");
    if (!ok) return NextResponse.json({ error: json?.error || "Falha" }, { status });
    return NextResponse.json({
      connected: !!json.connected, status: json.status ?? null,
      jid: json.jid ?? null, pushName: json.pushName ?? null, pictureUrl: json.pictureUrl ?? null,
    });
  } catch (e: any) {
    return abortSafe(e);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const parsed = parseAction((await params).action);
  if (!parsed) return NextResponse.json({ error: "Rota inválida" }, { status: 404 });
  const { base, session } = parsed;

  if (base === "qr" || base === "status" || base === "profile") {
    return NextResponse.json({ error: "Método não permitido" }, { status: 405 });
  }

  try {
    if (base === "reconnect") {
      const ctx = await getWAContextOrCron(req, session);
      if (!ctx) return errAuth();
      const { ok, status, json } = await proxyVM(ctx, "/reconnect", { method: "POST" });
      if (!ok) return NextResponse.json({ error: json?.error || "Falha" }, { status });
      return NextResponse.json({ success: true, status: "reconnecting" });
    }

    const ctx = await getWAContext(session);
    if (!ctx) return errAuth();

    if (base === "disconnect") {
      const { ok, status, json } = await proxyVM(ctx, "/disconnect", { method: "POST" });
      if (!ok) return NextResponse.json({ error: json?.error || "Falha" }, { status });
      return NextResponse.json({ success: true, status: json?.status ?? "disconnected" });
    }

    // config
    const body = await req.json().catch(() => ({}));

    // ✅ Se essa sessão está sendo marcada como "redireciona tudo pra outra
    // sessão", resolve aqui a sessionKey de destino (Sessão 1) — o serviço
    // de WhatsApp não tem acesso ao Supabase, então não consegue calcular
    // isso sozinho. getWAContext(1) resolve pro MESMO usuário logado, só
    // trocando o número da sessão no hash.
    if (body?.redirectEnabled === true) {
      const ctx1 = await getWAContext(1);
      if (ctx1) body.redirectToSessionKey = ctx1.sessionKey;
    }

    const { status, json } = await proxyVM(ctx, "/session-config", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(json, { status });
  } catch (e: any) {
    return abortSafe(e);
  }
}

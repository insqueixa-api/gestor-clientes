// app/api/whatsapp/bot/events/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 Corrigido: antes não exigia nenhuma autenticação (qualquer um na internet
// que achasse essa URL lia os últimos 100 eventos do bot — telefone, nome,
// prévia de mensagem) e mandava "x-session-key": "" fixo pro VM, que também
// não filtrava por sessão (getBotEvents() devolvia o buffer inteiro). Agora
// exige usuário logado (mesmo getWAContext usado em [action]/route.ts) e o
// VM só devolve os eventos da sessionKey real do tenant/usuário autenticado.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getWAContext } from "@/lib/whatsapp/wa-context";

export const dynamic = "force-dynamic";

async function fetchEventsForSession(session: 1 | 2): Promise<any[]> {
  const ctx = await getWAContext(session);
  if (!ctx) return [];
  try {
    const res = await fetch(`${ctx.baseUrl}/bot-events`, {
      headers: ctx.headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json?.events) ? json.events : [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  // ✅ Exige login — sessão 1 é a referência pra confirmar que o usuário está
  // autenticado e pertence a um tenant; sem ela, nem tenta buscar nada.
  const ctx1 = await getWAContext(1);
  if (!ctx1) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const [events1, events2] = await Promise.all([
    fetchEventsForSession(1),
    fetchEventsForSession(2),
  ]);

  const events = [...events1, ...events2].sort((a, b) => {
    const ta = new Date(a?.timestamp || 0).getTime();
    const tb = new Date(b?.timestamp || 0).getTime();
    return tb - ta;
  });

  return NextResponse.json({ ok: true, events });
}

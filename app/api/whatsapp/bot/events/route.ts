// app/api/whatsapp/bot/events/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 Corrigido: antes não exigia nenhuma autenticação (qualquer um na internet
// que achasse essa URL lia os últimos 100 eventos do bot — telefone, nome,
// prévia de mensagem) e mandava "x-session-key": "" fixo pro VM, que também
// não filtrava por sessão (getBotEvents() devolvia o buffer inteiro). Agora
// exige usuário logado (mesmo getWAContext usado em [action]/route.ts) e o
// VM só devolve os eventos da sessionKey real do tenant/usuário autenticado.
//
// ✅ Achado 08/08/2026 (pedido do Márcio): o VM só sabe o telefone — não tem
// acesso ao Supabase, então nome/usuário/servidor vinham nulos pra vários
// tipos de evento (ex: "Bot desligado"). Enriquecido aqui, do lado do
// Next.js, cruzando o telefone de cada evento com `clients` (nome/usuário/
// servidor) e `google_contacts` (foto já sincronizada na Agenda — reaproveita
// a MESMA integração que a página /admin/agenda já usa, não criei nada novo)
// — e resolvendo `next_state`/`action` num "caminho percorrido" legível.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getWAContext } from "@/lib/whatsapp/wa-context";
import { getAdminTenantContext } from "@/lib/api/auth-server";
import { createClient } from "@/lib/supabase/server";
import { resolveStateLabel } from "@/lib/whatsapp/bot-menu";
import { syncContactPhotoFromWhatsApp } from "@/lib/whatsapp/sync-contact-photo";

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

// ✅ Mesmo formato "021998892793" (DDD com 0 na frente) usado na Agenda —
// diferente do "5521998892793" (DDI + DDD + número) usado em toda parte no
// bot. Normaliza os dois pro mesmo formato antes de comparar.
function normalizePhone(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  const withoutLeadingZero = digits.replace(/^0/, "");
  return `55${withoutLeadingZero}`;
}

export async function GET(_req: Request) {
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

  const adminCtx = await getAdminTenantContext();
  if (!adminCtx.ok || !events.length) {
    return NextResponse.json({ ok: true, events });
  }
  const tenantId = adminCtx.tenantId;
  const sb = await createClient();

  // ✅ Só dígitos antes de entrar no filtro .or() — mesmo cuidado usado em
  // chat-admin/route.ts, evita que caractere estranho (ex: JID de grupo mal
  // formatado) quebre a sintaxe do filtro.
  const phones = [...new Set(events.map((e) => String(e?.phone || "").replace(/\D/g, "")).filter(Boolean))];
  if (!phones.length) return NextResponse.json({ ok: true, events });

  // ── Clientes reais (nome, usuário do servidor, nome do servidor) ─────────
  const orFilter = phones
    .map((p) => `whatsapp_username.eq.${p},secondary_whatsapp_username.eq.${p}`)
    .join(",");
  const { data: clients } = await sb
    .from("clients")
    .select("display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username, server_username, servers(name)")
    .eq("tenant_id", tenantId)
    .or(orFilter);

  const clientByPhone = new Map<string, { display_name: string | null; server_username: string | null; server_name: string | null }>();
  for (const c of clients || []) {
    const srv = (c as any).servers;
    const info = {
      display_name: c.display_name || null,
      server_username: c.server_username || null,
      server_name: srv?.name || null,
    };
    if (c.whatsapp_username) clientByPhone.set(String(c.whatsapp_username), info);
    if (c.secondary_whatsapp_username) {
      clientByPhone.set(String(c.secondary_whatsapp_username), {
        ...info,
        display_name: c.secondary_display_name || info.display_name,
      });
    }
  }

  // ── Foto: primeiro tenta a Agenda (google_contacts, já sincronizada via
  // Google People API — zero contato com o WhatsApp). Só quando o contato
  // JÁ existe na Agenda mas ainda SEM foto, tenta buscar no WhatsApp como
  // último recurso — 1 requisição por contato distinto desse lote (nunca em
  // massa: achado em auditoria de risco de banimento, 09/08/2026, sobre
  // coleta automatizada de fotos de perfil ser motivo de suspensão). Contato
  // que nem está na Agenda não tem foto buscada de jeito nenhum.
  const { data: contacts } = await sb
    .from("google_contacts")
    .select("id, avatar_url, phone_e164, secondary_phone")
    .eq("tenant_id", tenantId);

  const photoByPhone = new Map<string, { avatar_url: string | null; google_contact_id: string }>();
  for (const c of contacts || []) {
    const entry = { avatar_url: c.avatar_url || null, google_contact_id: c.id };
    const p1 = normalizePhone(c.phone_e164);
    const p2 = normalizePhone(c.secondary_phone);
    if (p1) photoByPhone.set(p1, entry);
    if (p2) photoByPhone.set(p2, entry);
  }

  // Fallback pro WhatsApp — só pros telefones deste lote que já têm um
  // registro na Agenda mas continuam sem foto. Sequencial, com teto e
  // pequeno intervalo entre chamadas — mesmo sendo poucos contatos, não
  // cria nenhum padrão de rajada contra o WhatsApp.
  const MAX_FALLBACK_PHOTO_FETCHES = 10;
  const phonesMissingPhoto = phones.filter((phone) => {
    const entry = photoByPhone.get(normalizePhone(phone));
    return entry && !entry.avatar_url;
  }).slice(0, MAX_FALLBACK_PHOTO_FETCHES);

  for (const phone of phonesMissingPhoto) {
    const entry = photoByPhone.get(normalizePhone(phone))!;
    const result = await syncContactPhotoFromWhatsApp(sb, tenantId, entry.google_contact_id, `${phone}@s.whatsapp.net`);
    if (result.ok) entry.avatar_url = result.avatar_url;
    await new Promise((r) => setTimeout(r, 400));
  }

  const enriched = await Promise.all(
    events.map(async (e) => {
      const phone = String(e?.phone || "").replace(/\D/g, "");
      const clientInfo = clientByPhone.get(phone);
      const photoInfo = photoByPhone.get(normalizePhone(phone));
      const path_label = await resolveStateLabel(sb, tenantId, e?.next_state);
      return {
        ...e,
        display_name: clientInfo?.display_name || e.display_name || null,
        server_name: clientInfo?.server_name || e.server_name || null,
        server_username: clientInfo?.server_username || e.server_username || null,
        avatar_url: photoInfo?.avatar_url || null,
        google_contact_id: photoInfo?.google_contact_id || null,
        path_label,
      };
    })
  );

  return NextResponse.json({ ok: true, events: enriched });
}

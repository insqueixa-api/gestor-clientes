"use client";
// app/admin/cliente/[id]/page.tsx
import {
  Loader2,
  CreditCard,
  Pencil,
  RefreshCcw,
  EyeOff,
  Eye,
  Trash2,
} from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import ClientAlertBell from "@/components/alerts/ClientAlertBell";
import { Modal } from "@/components/ui/Modal";

// Componentes (CORRIGIDO: PascalCase)
import NovoCliente, { ClientData } from "../novo_cliente";
import RecargaCliente from "../recarga_cliente";
import CupomModal from "../../settings/cupons/cupom_modal";

// --- HELPERS ---
function formatPhoneDisplay(e164: string | null | undefined) {
  if (!e164) return "Não informado";
  const digits = String(e164).replace(/\D+/g, "");
  if (!digits) return "Não informado";

  // Formatação BR simples se começar com 55
  if (digits.startsWith("55")) {
    const local = digits.slice(2);
    if (local.length === 11)
      return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    if (local.length === 10)
      return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return `+${digits}`;
}

function extractPeriod(planName: string) {
  const p = (planName || "").trim();
  if (!p || p === "—") return "—";
  if (p.toLowerCase().includes("personalizado")) return "Mensal";
  if (p.includes("-")) {
    const parts = p.split("-");
    return parts[parts.length - 1].trim();
  }
  return p;
}

function tableLabelFromClient(
  c: { plan_table_name?: string | null } | null | undefined,
) {
  const raw = String(c?.plan_table_name ?? "").trim();
  if (!raw || raw === "—") return "—";
  return raw;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    OVERDUE: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    TRIAL: "bg-sky-500/10 text-sky-500 border-sky-500/20",
    ARCHIVED: "bg-muted text-muted-foreground border-border",
  };
  const labelMap: Record<string, string> = {
    ACTIVE: "Ativo",
    OVERDUE: "Vencido",
    TRIAL: "Teste",
    ARCHIVED: "Arquivado",
  };
  return (
    <span
      className={`px-2.5 py-0.5 rounded-lg text-[11px] font-medium border shadow-sm ${map[status] || map.ACTIVE}`}
    >
      {labelMap[status] || status}
    </span>
  );
}

function fmtMoney(
  val: number | null | undefined,
  cur: string | null | undefined,
) {
  const n = Number(val || 0);
  if (!n || n <= 0) return "—";
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: cur || "BRL",
  }).format(n);
  return formatted.replace(/^US(\$)/, "$1");
}

function fmtDate(d: string) {
  if (!d) return "--";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "--";
  return (
    dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) +
    " " +
    dt.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    })
  );
}

function fmtDateTime(d: string) {
  if (!d) return "--";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "--";
  return `${dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} às ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`;
}

// --- TIPOS (ALINHADO COM AS VIEWS vw_clients_list_*) ---
type VwClientRow = {
  id: string;

  client_name: string | null;
  username: string | null;
  server_password?: string | null;

  vencimento: string | null; // timestamptz
  computed_status: "ACTIVE" | "OVERDUE" | "TRIAL" | "ARCHIVED" | string;
  client_is_archived: boolean | null;

  screens: number | null;

  plan_name: string | null;
  price_amount: number | null;
  price_currency: string | null;

  // ✅ NOVO (fonte da verdade)
  plan_table_id?: string | null;
  plan_table_name?: string | null;

  server_id: string | null;
  server_name: string | null;
  technology: string | null; // ✅ NOVO

  whatsapp_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_opt_in: boolean | null;
  secondary_display_name?: string | null;
  secondary_name_prefix?: string | null;
  secondary_phone_e164?: string | null;
  secondary_whatsapp_username?: string | null;
  dont_message_until: string | null;

  apps_names: string[] | null;
  apps_details?: { name: string; expiration?: string | null }[]; // ✅ Adicionado
  alerts_open: number;

  notes: string | null;
  // ✅ (não vem da view; vamos buscar na tabela clients)
  m3u_url?: string | null;
};

type ClientDetail = {
  id: string;
  client_name: string;
  username: string;

  server_id: string;
  server_name: string;
  technology: string | null; // ✅ NOVO

  plan_name: string;
  price_amount: number | null;
  price_currency: string | null;
  // ✅ NOVO (fonte da verdade)
  plan_table_id?: string | null;
  plan_table_name?: string | null;

  vencimento: string | null;
  computed_status: string;
  client_is_archived: boolean;

  screens: number;

  whatsapp_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_opt_in: boolean | null;
  dont_message_until: string | null;

  name_prefix?: string | null; // ✅ ADICIONADO: Saudação Principal

  // ✅ NOVOS CAMPOS SECUNDÁRIOS ADICIONADOS AQUI
  secondary_display_name?: string | null;
  secondary_name_prefix?: string | null;
  secondary_phone_e164?: string | null;
  secondary_whatsapp_username?: string | null;

  apps_names: string[] | null;
  alerts_open: number;

  notes: string | null;

  // ✅ M3U
  m3u_url: string | null;

  // extras úteis para o modal editar
  server_password?: string | null;

  // ✅ NOVO
  created_at: string | null;
};

type TimelineItem = {
  id: string;
  created_at: string;
  event_type: string;
  message: string | null;
  meta: any;
};

type EligibleCouponRule = {
  target_status: string[] | null;
  target_server_names: string[];
  target_plan_labels: string[] | null;
  target_app_names: string[] | null;
  rule_date_field: "vencimento" | "cadastro" | null;
  rule_days_min: number | null;
  rule_days_max: number | null;
  max_total_redemptions: number | null;
  used_count: number | null;
};

type EligibleCouponRow = {
  id: string;
  code: string;
  description: string | null;
  kind: "personal" | "general";
  discount_label: string;
  bot_visible: boolean;
  is_bot_pick: boolean;
  rule: EligibleCouponRule | null;
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Ativo",
  OVERDUE: "Vencido",
  TRIAL: "Teste",
};

/** Regras ativas de um cupom geral, em fragmentos curtos — só o que tem
 * restrição de verdade aparece (sem filtro numa dimensão = não mostra nada). */
function formatCouponRuleChips(rule: EligibleCouponRule | null): string[] {
  if (!rule) return [];
  const chips: string[] = [];

  if (rule.target_status?.length) {
    chips.push(rule.target_status.map((s) => STATUS_LABELS[s] || s).join(", "));
  }
  if (rule.target_server_names.length) {
    chips.push(rule.target_server_names.join(", "));
  }
  if (rule.target_plan_labels?.length) {
    chips.push(rule.target_plan_labels.join(", "));
  }
  if (rule.target_app_names?.length) {
    chips.push(rule.target_app_names.join(", "));
  }
  if (rule.rule_date_field && (rule.rule_days_min != null || rule.rule_days_max != null)) {
    const fieldLabel = rule.rule_date_field === "vencimento" ? "Vencimento" : "Cadastro";
    const bound = (d: number) => `${Math.abs(d)}d ${d < 0 ? "antes" : "depois"}`;
    const range =
      rule.rule_days_min != null && rule.rule_days_max != null
        ? `${bound(rule.rule_days_min)} até ${bound(rule.rule_days_max)}`
        : rule.rule_days_min != null
          ? `a partir de ${bound(rule.rule_days_min)}`
          : `até ${bound(rule.rule_days_max!)}`;
    chips.push(`${fieldLabel}: ${range}`);
  }
  if (rule.max_total_redemptions != null) {
    chips.push(`${rule.used_count ?? 0}/${rule.max_total_redemptions} usados`);
  }

  return chips;
}

export default function ClientDetailsPage() {
  const resolvedTenantId = useTenantId();
  const params = useParams();
  const { confirm, ConfirmUI } = useConfirm(); // ✅ ADICIONADO ConfirmUI

  // ✅ aceita /[id] ou /[client_id] ou /[clientId] ou /[clienteId]
  const p = params as any;
  const clientIdRaw = (p?.id ?? p?.client_id ?? p?.clientId ?? p?.clienteId) as
    string | string[] | undefined;

  const clientId = Array.isArray(clientIdRaw) ? clientIdRaw[0] : clientIdRaw;
  const clientIdSafe = (clientId ?? "").trim();

  const [valuesHidden, setValuesHidden] = useState(false);
  const [expandedAppIcon, setExpandedAppIcon] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(resolvedTenantId);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [showQuickTrialModal, setShowQuickTrialModal] = useState(false);
  const [editClientPayload, setEditClientPayload] = useState<ClientData | null>(
    null,
  );

  // ✅ Estados para os spinners de 5 segundos nos botões
  const [isEditingLoading, setIsEditingLoading] = useState(false);
  const [isTrialLoading, setIsTrialLoading] = useState(false);
  const [isRenewLoading, setIsRenewLoading] = useState(false); // ✅ NOVO: Estado para o aviso de alerta antes da renovação
  const [showRenewWarning, setShowRenewWarning] = useState(false);

  // --- TOASTS (5s) ---
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  // --- CUPONS ELEGÍVEIS ---
  const [eligibleCoupons, setEligibleCoupons] = useState<EligibleCouponRow[]>(
    [],
  );
  const [loadingCoupons, setLoadingCoupons] = useState(false);
  const [showCupomModal, setShowCupomModal] = useState(false);

  async function handleDeleteEvent(item: TimelineItem) {
    const ok = await confirm({
      tone: "rose",
      title: "Apagar registro?",
      subtitle: "Este evento será removido da linha do tempo permanentemente.",
      details: [
        `Tipo: ${EVENT_LABELS[item.event_type] ?? item.event_type}`,
        `Data: ${fmtDate(item.created_at)}`,
        item.message ? `Msg: ${item.message.slice(0, 60)}` : "",
      ].filter(Boolean),
      confirmText: "Apagar",
      cancelText: "Voltar",
    });

    if (!ok) return;

    setDeletingEventId(item.id);
    try {
      const tid = tenantId;
      if (!tid) throw new Error("Tenant não encontrado");

      const { error } = await supabaseBrowser
        .from("client_events")
        .delete()
        .eq("id", item.id)
        .eq("tenant_id", tid);

      if (error) throw error;

      setTimeline((prev) => prev.filter((e) => e.id !== item.id));
      addToast(
        "success",
        "Registro apagado",
        "Evento removido da linha do tempo.",
      );
    } catch (e: any) {
      addToast(
        "error",
        "Erro ao apagar",
        e?.message || "Falha ao deletar evento.",
      );
    } finally {
      setDeletingEventId(null);
    }
  }
  function addToast(
    type: "success" | "error",
    title: string,
    message?: string,
  ) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 5000);
  }
  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const isMessageBlocked = useMemo(() => {
    const until = client?.dont_message_until;
    if (!until) return false;
    return new Date(until).getTime() > Date.now();
  }, [client?.dont_message_until]);

  async function loadData() {
    if (!clientIdSafe) return;

    setLoading(true);
    try {
      const tid = tenantId;
      if (!tid) {
        setClient(null);
        setTimeline([]);
        setLoading(false);
        return;
      }

      // ✅ 0) Prepara dicionário de Apps direto da tabela (Acesso Total e Direto)
      const localAppsById: Record<string, any> = {};
      const { data: rawAppsData } = await supabaseBrowser
        .from("apps")
        .select("*")
        .eq("is_active", true);

      if (rawAppsData) {
        for (const a of rawAppsData) {
          if (a?.id) localAppsById[String(a.id)] = a;
        }
      }

      // 1) tenta na view ACTIVE
      const r1 = await supabaseBrowser
        .from("vw_clients_list_active")
        .select("*")
        .eq("tenant_id", tid)
        .eq("id", clientIdSafe)
        .maybeSingle();

      // 2) se não achou, tenta na view ARCHIVED
      const r2 = r1.data
        ? { data: null as any, error: null as any }
        : await supabaseBrowser
            .from("vw_clients_list_archived")
            .select("*")
            .eq("tenant_id", tid)
            .eq("id", clientIdSafe)
            .maybeSingle();

      const row = ((r1.data || r2.data) as VwClientRow | null) ?? null;

      if (!row) {
        setClient(null);
        setTimeline([]);
        setLoading(false);
        return;
      }
      // ✅ Fonte da verdade: clients
      let dbPlanTableId: string | null = null;
      let dbNotes: string | null = null;
      let dbPriceCurrency: string | null = null;

      // ✅ Nome final da tabela (plan_tables > view)
      let finalTableName: string | null = null;

      // ✅ M3U
      let dbM3uUrl: string | null = null;

      // ✅ Data de Cadastro
      let dbCreatedAt: string | null = null;

      // ✅ Contatos Secundários
      let dbSecName: string | null = null;
      let dbSecPhone: string | null = null;
      let dbSecUsername: string | null = null;
      let dbNamePrefix: string | null = null; // ✅ NOVA VARIÁVEL PARA O PREFIXO

      try {
        // 1) pega ID da tabela e notes direto da tabela clients
        const c = await supabaseBrowser
          .from("clients")
          // ✅ INCLUÍDO O name_prefix NA BUSCA
          .select(
            "plan_table_id, notes, price_currency, m3u_url, created_at, secondary_display_name, secondary_phone_e164, secondary_whatsapp_username, name_prefix",
          )
          .eq("tenant_id", tid)
          .eq("id", clientIdSafe)
          .maybeSingle();

        if (!c.error && c.data) {
          dbCreatedAt = (c.data as any).created_at ?? null;
          dbPlanTableId = (c.data as any).plan_table_id ?? null;

          const n = (c.data as any).notes;
          dbNotes = typeof n === "string" ? n : null;

          const pc = (c.data as any).price_currency;
          dbPriceCurrency = typeof pc === "string" ? pc : null;

          const m3u = (c.data as any).m3u_url;
          dbM3uUrl = typeof m3u === "string" ? m3u : null;

          dbSecName = (c.data as any).secondary_display_name ?? null;
          dbSecPhone = (c.data as any).secondary_phone_e164 ?? null;
          dbSecUsername = (c.data as any).secondary_whatsapp_username ?? null;
          dbNamePrefix = (c.data as any).name_prefix ?? null; // ✅ PEGA O PREFIXO DO BANCO
        }

        // 2) tenta nome vindo da view (fallback)
        const viewNameRaw = String((row as any).plan_table_name ?? "").trim();
        if (viewNameRaw && viewNameRaw !== "—") finalTableName = viewNameRaw;

        // 3) se tem ID da tabela, o nome oficial vem de plan_tables (prioridade)
        if (dbPlanTableId) {
          const t = await supabaseBrowser
            .from("plan_tables")
            .select("name")
            .eq("id", dbPlanTableId)
            .maybeSingle();

          if (!t.error && t.data?.name) finalTableName = String(t.data.name);
        }
      } catch {}

      const mapped: ClientDetail = {
        id: String(row.id),
        client_name: String(row.client_name ?? "Sem Nome"),
        username: String(row.username ?? "—"),

        server_id: String(row.server_id ?? ""),
        server_name: String(row.server_name ?? row.server_id ?? "—"),
        technology: row.technology ?? "—", // ✅ Mapeia

        plan_name: String(row.plan_name ?? "—"),
        price_amount: row.price_amount ?? null,
        price_currency: dbPriceCurrency ?? row.price_currency ?? "BRL",

        // ✅ fonte da verdade (clients)
        plan_table_id: dbPlanTableId ?? (row as any).plan_table_id ?? null,
        plan_table_name: finalTableName ?? null,

        vencimento: row.vencimento ?? null,
        computed_status: String(row.computed_status ?? "ACTIVE"),
        client_is_archived: Boolean(row.client_is_archived),

        screens: Number(row.screens || 1),

        whatsapp_e164: row.whatsapp_e164 ?? null,
        whatsapp_username: row.whatsapp_username ?? null,
        whatsapp_opt_in:
          typeof row.whatsapp_opt_in === "boolean" ? row.whatsapp_opt_in : true,
        dont_message_until: row.dont_message_until ?? null,

        name_prefix: dbNamePrefix ?? (row as any).name_prefix ?? null, // ✅ MAPEIA O PREFIXO PRINCIPAL

        // ✅ MAPEIA OS SECUNDÁRIOS (Puxa da fonte da verdade primeiro)
        secondary_display_name:
          dbSecName ?? (row as any).secondary_display_name ?? null,
        secondary_phone_e164:
          dbSecPhone ?? (row as any).secondary_phone_e164 ?? null,
        secondary_whatsapp_username:
          dbSecUsername ?? (row as any).secondary_whatsapp_username ?? null,

        apps_names: row.apps_names ?? null,
        alerts_open: Number(row.alerts_open || 0),

        notes: (dbNotes ?? row.notes ?? "") as any,

        // ✅ M3U vindo da fonte da verdade (clients)
        m3u_url: dbM3uUrl ?? null,

        server_password: row.server_password ?? null,
        created_at: dbCreatedAt ?? (row as any).created_at ?? null, // ✅ ADICIONADO AQUI
      };

      // ✅ BUSCA REAL: Vencimento dos Apps (Bypass RLS cruzando com o dicionário local)
      const { data: appsData } = await supabaseBrowser
        .from("client_apps")
        .select("id, app_id, field_values") // ❌ Removido o join com 'apps'
        .eq("client_id", mapped.id);

      if (appsData) {
        (mapped as any).apps_details = appsData.map((item: any) => {
          // ✅ Busca no dicionário que acabamos de criar via RPC
          const catalogApp = localAppsById[String(item.app_id)];
          const vals = item.field_values || {};
          const config = Array.isArray(catalogApp?.fields_config)
            ? catalogApp.fields_config
            : [];

          let expiration =
            vals["Vencimento"] ||
            vals["vencimento"] ||
            vals["VENCIMENTO"] ||
            null;

          // 1. Se não achou pelo nome fixo, procura qual campo na configuração é do tipo "date"
          if (!expiration) {
            const dateField = config.find(
              (f: any) => f.type === "date" || /vencimento/i.test(f.label),
            );
            if (dateField) {
              expiration = vals[dateField.id] || vals[dateField.label] || null;
            }
          }

          // 2. Fallback extremo: procura qualquer valor salvo que tenha formato de data (YYYY-MM-DD)
          if (!expiration) {
            const possibleDate = Object.values(vals).find(
              (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v),
            );
            if (possibleDate) expiration = possibleDate;
          }

          return {
            id: item.id,
            name: catalogApp?.name || "App (Não encontrado)",
            expiration: expiration,
            icon_url: catalogApp?.icon_url || null,
          };
        });
      }

      setClient(mapped);

      // ✅ Timeline real: client_events
      const ev = await supabaseBrowser
        .from("client_events")
        .select("id, created_at, event_type, message, meta")
        .eq("tenant_id", tid)
        .eq("client_id", mapped.id) // ou String(clientId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (ev.error) {
        addToast("error", "Falha ao carregar timeline", ev.error.message);
        setTimeline([]);
      } else {
        setTimeline((ev.data || []) as any);
      }

      setLoading(false);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || "Erro ao carregar";
      addToast("error", "Falha ao carregar cliente", msg);
      setClient(null);
      setTimeline([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadEligibleCoupons(id: string) {
    setLoadingCoupons(true);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(`/api/admin/clients/${id}/eligible-coupons`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => ({}));
      setEligibleCoupons(res.ok ? json.coupons || [] : []);
    } catch {
      setEligibleCoupons([]);
    } finally {
      setLoadingCoupons(false);
    }
  }

  useEffect(() => {
    if (client?.id) loadEligibleCoupons(client.id);
  }, [client?.id]);

  async function handleArchiveToggle() {
    if (!client) return;

    const goingToArchive = !client.client_is_archived;

    const ok = await confirm({
      tone: goingToArchive ? "rose" : "emerald",
      title: goingToArchive ? "Arquivar cliente?" : "Restaurar cliente?",
      subtitle: goingToArchive
        ? "Ele irá para a Lixeira e não aparecerá na lista principal."
        : "Ele voltará para a lista principal de clientes.",
      details: [
        `Cliente: ${client.client_name}`,
        `Usuário: ${client.username}`,
        `Servidor: ${client.server_name}`,
      ],
      confirmText: goingToArchive ? "Arquivar" : "Restaurar",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      const tid = tenantId;
      if (!tid) throw new Error("Tenant não encontrado");

      // ⚠️ IMPORTANTE: só adicione p_created_by SE a assinatura do RPC pedir (confirme no SQL)
      const payload: any = {
        p_tenant_id: tid,
        p_client_id: client.id,
        p_is_archived: goingToArchive,
        // p_created_by: "e2994494-a79e-4b04-901b-72b7a55e3a8a",
      };

      const { error } = await supabaseBrowser.rpc("update_client", payload);
      if (error) throw error;

      addToast(
        "success",
        goingToArchive ? "Cliente arquivado" : "Cliente restaurado",
      );
      loadData();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || "Erro desconhecido";
      addToast("error", "Falha ao atualizar cliente", msg);
    }
  }

  const handleDeleteForever = async () => {
    if (!client) return; // ✅ Removida a dependência da variável externa tenantId

    if (!client.client_is_archived) {
      addToast(
        "error",
        "Ação bloqueada",
        "Só é possível excluir definitivamente um cliente que está na Lixeira.",
      );
      return;
    }

    const ok = await confirm({
      title: "Excluir definitivamente?",
      subtitle:
        "Isso vai remover o cliente e TODOS os seus registros (pagamentos, alertas, histórico).",
      tone: "rose",
      confirmText: "Excluir definitivo",
      cancelText: "Voltar",
      details: [`Cliente: ${client.client_name}`, "Ação irreversível"],
    });

    if (!ok) return;

    try {
      const tid = tenantId; // ✅ Puxa o ID na hora, como no handleArchiveToggle
      if (!tid) throw new Error("Tenant não encontrado");

      const { error } = await supabaseBrowser.rpc("delete_client_forever", {
        p_tenant_id: tid, // ✅ Usa a constante local
        p_client_id: client.id,
      });

      if (error) throw error;

      // ✅ Joga de volta pra listagem geral de clientes (já que ele não existe mais)
      window.location.href = "/admin/cliente";
    } catch (e: any) {
      addToast("error", "Erro ao excluir", e.message);
    }
  };

  // ✅ NOVO: Intercepta o clique no botão Renovar
  const handleRenewClick = () => {
    if (client && client.alerts_open > 0) {
      setShowRenewWarning(true);
    } else {
      setShowRenewModal(true);
    }
  };

  if (!clientIdSafe) {
    return (
      <div className="p-10 text-center text-rose-500 font-medium">
        Rota inválida: não encontrei o <span className="font-mono">id</span> do
        cliente nos params.
      </div>
    );
  }

  const EVENT_LABELS: Record<string, any> = {
    RENEWAL: "💰 Renovação",
    CLIENT_CREATED: "🆕 Cliente criado",
    TRIAL_CREATED: (
      <span className="flex items-center gap-1.5">
        <IconFastTimer /> Teste criado
      </span>
    ),
    CLIENT_ARCHIVED: "📦 Arquivado",
    CLIENT_RESTORED: "♻️ Restaurado",
    TRIAL_CONVERTED: "✨ Convertido",
    RENEWAL_DEBIT: "🔄 Débito de renovação",
  };

  if (loading)
    return (
      <div className="p-10 text-center text-muted-foreground/60 animate-pulse font-medium">
        Carregando...
      </div>
    );
  if (!client)
    return (
      <div className="p-10 text-center text-rose-500 font-medium">
        Cliente não encontrado.
      </div>
    );

  return (
    // ✅ Ajuste: pt-0 px-0 no mobile (full width), sm:px-6 no desktop
    <div className="space-y-4 sm:space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-3 pb-0 mb-4 px-4 sm:px-0 pt-4 sm:pt-0">
        {/* Título (Nome + Badge) */}
        <div className="min-w-0 text-left flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              {client.client_name}
            </h1>
            <StatusBadge status={client.computed_status} />
            {clientIdSafe && (
              <ClientAlertBell
                tenantId={tenantId}
                clientId={clientIdSafe}
                clientName={client.client_name}
                clientUsername={client.username}
                alertsCount={client.alerts_open || 0}
                onChanged={loadData}
                addToast={addToast}
                size="lg"
                hideWhenEmpty
              />
            )}
            <button
              onClick={() => setValuesHidden((v) => !v)}
              title={valuesHidden ? "Exibir valores" : "Ocultar valores"}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all text-xs font-medium shadow-sm select-none"
            >
              {valuesHidden ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              <span className="hidden sm:inline text-[11px] tracking-wide">
                {valuesHidden ? "Exibir" : "Ocultar"}
              </span>
            </button>
          </div>
          <span className="text-xs text-muted-foreground font-medium truncate">
            {client.username}
          </span>
        </div>

        {/* Botões de Ação (Responsivos) */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Voltar (Só no Desktop) */}
          <Link
            href="/admin/cliente"
            prefetch={false}
            className="hidden sm:inline-flex h-9 px-3 rounded-lg border border-border text-muted-foreground font-medium text-xs hover:bg-muted transition-all items-center justify-center"
          >
            Voltar
          </Link>

          {/* ✅ Botão Excluir Definitivamente (Só aparece se estiver arquivado) */}
          {client.client_is_archived && (
            <button
              onClick={handleDeleteForever}
              className="h-9 sm:h-9 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 font-medium text-xs hover:bg-rose-500/20 transition-all shadow-sm inline-flex items-center justify-center gap-2"
              title="Excluir para sempre"
            >
              <IconTrash />
              <span className="hidden sm:inline">Excluir para sempre</span>
            </button>
          )}

          {/* Botão Arquivar (Icone no Mobile, Texto no Desktop) */}
          <button
            onClick={handleArchiveToggle}
            className={`h-9 sm:h-9 px-3 rounded-lg border font-medium text-xs transition-all shadow-sm inline-flex items-center justify-center gap-2 ${
              client.client_is_archived
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/20"
                : "bg-rose-500/10 border-rose-500/20 text-rose-500 hover:bg-rose-500/20"
            }`}
            title={client.client_is_archived ? "Restaurar" : "Arquivar"}
          >
            {client.client_is_archived ? <IconRestore /> : <IconTrash />}
            <span className="hidden sm:inline">
              {client.client_is_archived ? "Restaurar" : "Arquivar"}
            </span>
          </button>

          {/* Botão Editar */}
          <button
            onClick={() => {
              setEditClientPayload({
                id: client.id,
                client_name: client.client_name,
                name_prefix: client.name_prefix ?? undefined,
                username: client.username,
                server_password: client.server_password ?? undefined,
                whatsapp_e164: client.whatsapp_e164 ?? undefined,
                whatsapp_username: client.whatsapp_username ?? undefined,
                whatsapp_opt_in: client.whatsapp_opt_in ?? true,
                secondary_display_name:
                  client.secondary_display_name ?? undefined,
                secondary_name_prefix:
                  client.secondary_name_prefix ?? undefined,
                secondary_phone_e164: client.secondary_phone_e164 ?? undefined,
                secondary_whatsapp_username:
                  client.secondary_whatsapp_username ?? undefined,
                dont_message_until: client.dont_message_until ?? undefined,
                server_id: client.server_id,
                screens: client.screens,
                technology: client.technology ?? undefined,
                plan_name: client.plan_name ?? undefined,
                price_amount: client.price_amount ?? undefined,
                price_currency: client.price_currency ?? undefined,
                plan_table_id: (client as any).plan_table_id ?? null,
                plan_table_name: (client as any).plan_table_name ?? null,
                m3u_url: client.m3u_url ?? undefined,
                vencimento: client.vencimento ?? undefined,
                notes: client.notes ?? undefined,
                apps_names: client.apps_names ?? undefined,
              });
              setShowEditModal(true);
              setIsEditingLoading(true);
              setTimeout(() => setIsEditingLoading(false), 5000);
            }}
            disabled={isEditingLoading}
            className="h-9 sm:h-9 px-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 font-medium text-xs hover:bg-amber-500/20 transition-all shadow-sm inline-flex items-center justify-center gap-2"
            title="Editar"
          >
            {isEditingLoading ? <IconLoading /> : <IconEdit />}
            <span className="hidden sm:inline">Editar</span>
          </button>

          {/* ✅ Botão Teste Rápido */}
          <button
            onClick={() => {
              setShowQuickTrialModal(true);
              setIsTrialLoading(true);
              setTimeout(() => setIsTrialLoading(false), 5000);
            }}
            disabled={client.client_is_archived || isTrialLoading}
            className="h-9 sm:h-9 px-3 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-500 font-medium text-xs hover:bg-sky-500/20 transition-all shadow-sm inline-flex items-center gap-2 justify-center"
            title="Criar teste rápido com os dados deste cliente"
          >
            {isTrialLoading ? <IconLoading /> : <IconFastTimer />}
            <span className="hidden sm:inline">Teste Rápido</span>
          </button>

          {/* Botão Renovar */}
          <button
            onClick={() => {
              handleRenewClick();
              setIsRenewLoading(true);
              setTimeout(() => setIsRenewLoading(false), 5000);
            }}
            disabled={client.client_is_archived || isRenewLoading}
            className="h-9 sm:h-9 px-3 sm:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 justify-center"
            title="Renovar"
          >
            {isRenewLoading ? <IconLoading /> : <IconMoney />}
            <span className="hidden sm:inline">Renovar</span>
          </button>
        </div>
      </div>
      {/* GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 px-0 sm:px-0">
        {/* COLUNA ESQUERDA */}
        <div className="space-y-4">
          {/* 1. CARD ASSINATURA ATUAL */}
          <div className="bg-card border-y sm:border border-border sm:rounded-xl p-4 shadow-sm transition-colors">
            <h3 className="text-[10px] font-medium text-foreground/80 uppercase mb-3 tracking-widest">
              Assinatura atual
            </h3>

            <div className="space-y-3 text-sm">
              {/* BLOCO DE ACESSO (Sem bordas internas) */}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-medium">
                  Servidor
                </span>
                <span className="font-medium text-foreground text-right">
                  {client.server_name}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-medium">
                  Tecnologia
                </span>
                {(() => {
                  const tech = client.technology || "";
                  const t = tech.toUpperCase();
                  const colors =
                    t === "IPTV"
                      ? "bg-sky-500/10 text-sky-500 border-sky-500/20"
                      : t === "P2P"
                        ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                        : "bg-muted text-muted-foreground border-border";
                  return (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium tracking-tight shadow-sm uppercase ${colors}`}
                    >
                      {client.technology || "—"}
                    </span>
                  );
                })()}
              </div>

              {/* LISTA DE APPS (Com Vencimento Real do Banco - Suportando Múltiplos) */}
              {(client as any).apps_details &&
                (client as any).apps_details.length > 0 && (
                  <div className="space-y-3 pt-1">
                    {(client as any).apps_details.map((app: any) => {
                      // ✅ Verifica se o vencimento é inferior a 30 dias (ou se já venceu)
                      const expirationDatePart = app.expiration
                        ? String(app.expiration).split("T")[0]
                        : "";
                      const isExpiringSoon =
                        expirationDatePart &&
                        (new Date(`${expirationDatePart}T12:00:00`).getTime() -
                          Date.now()) /
                          86400000 <
                          30;

                      return (
                        <div
                          key={app.id || app.name + Math.random()}
                          className="flex justify-between items-center"
                        >
                          <span
                            className="text-muted-foreground font-medium flex items-center gap-1.5"
                            title={app.name}
                          >
                            {app.icon_url ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedAppIcon({
                                    url: app.icon_url,
                                    name: app.name,
                                  })
                                }
                                className="shrink-0 rounded overflow-hidden active:scale-95 transition-transform"
                                title={`Ampliar ícone: ${app.name}`}
                              >
                                <img
                                  src={app.icon_url}
                                  alt=""
                                  className="w-6 h-6 rounded object-cover"
                                />
                              </button>
                            ) : (
                              <span className="text-[11px]">📱</span>
                            )}
                            {app.name}
                          </span>
                          <span
                            className={`text-xs text-right ${app.expiration ? (isExpiringSoon ? "text-rose-500 font-medium" : "text-emerald-500 font-medium") : "text-muted-foreground/60 italic"}`}
                          >
                            {expirationDatePart
                              ? `Vence: ${new Date(`${expirationDatePart}T12:00:00-03:00`).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                              : "Vencimento: Não definido"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

              {/* DIVISOR FINANCEIRO (Com margem ajustada) */}
              <div className="pt-3 pb-1">
                <div className="border-t border-border mb-3"></div>
                <div className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest">
                  Financeiro
                </div>
              </div>

              {/* BLOCO FINANCEIRO (Sem bordas internas) */}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-medium">
                  Tabela
                </span>
                <span className="font-medium text-foreground/90 tracking-tight text-right">
                  {tableLabelFromClient(client)}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-medium">Plano</span>
                <span className="font-medium text-emerald-500 tracking-tight">
                  {extractPeriod(client.plan_name)}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-medium">Telas</span>
                <span className="font-medium text-foreground">
                  {client.screens}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-medium">Valor</span>
                <span
                  className={`font-medium text-foreground bg-transparent px-2 py-0.5 rounded-md transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                >
                  {fmtMoney(client.price_amount, client.price_currency)}
                </span>
              </div>

              {/* VENCIMENTO GERAL DESTACADO */}
              <div className="pt-2">
                <div className="flex justify-between items-center bg-transparent p-3 rounded-lg border border-border mt-1">
                  <span className="text-muted-foreground font-medium text-[11px] uppercase tracking-tight">
                    Vencimento
                  </span>
                  <div
                    className={`text-right font-medium text-base transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""} ${client.computed_status === "OVERDUE" ? "text-rose-500" : client.computed_status === "ACTIVE" ? "text-emerald-500" : "text-muted-foreground"}`}
                  >
                    {client.vencimento ? fmtDateTime(client.vencimento) : "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 2. CARD CONTATOS E OBSERVAÇÕES */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm transition-colors">
            <h3 className="text-[11px] font-medium text-foreground/80 uppercase mb-4 tracking-widest">
              Contatos e observações
            </h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center pb-2 border-b border-border">
                <span className="text-muted-foreground font-medium">
                  Data do Cadastro
                </span>
                <span className="font-medium text-foreground text-right">
                  {client.created_at
                    ? new Date(client.created_at).toLocaleDateString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })
                    : "—"}
                </span>
              </div>

              <div className="flex justify-between items-center pb-2 border-b border-border">
                <span className="text-muted-foreground font-medium">
                  Nome do Cliente
                </span>
                <span className="font-medium text-foreground text-right">
                  {client.client_name}
                </span>
              </div>

              <div className="flex justify-between items-center pb-2 border-b border-border">
                <span className="text-muted-foreground font-medium">
                  Telefone Principal
                </span>
                <span
                  className={`font-medium text-foreground text-right transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                >
                  {formatPhoneDisplay(client.whatsapp_e164)}
                </span>
              </div>

              {/* WhatsApp Principal com Link */}
              <div className="flex justify-between items-center pb-2 border-b border-border">
                <span className="text-muted-foreground font-medium">
                  WhatsApp Principal
                </span>
                <span
                  className={`transition-all duration-300 ${valuesHidden ? "blur-sm select-none pointer-events-none" : ""}`}
                >
                  {client.whatsapp_username ? (
                    <a
                      href={`https://wa.me/${client.whatsapp_e164?.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-emerald-500 font-medium hover:underline text-right"
                    >
                      <IconWhatsapp />@{client.whatsapp_username}
                    </a>
                  ) : client.whatsapp_e164 ? (
                    <a
                      href={`https://wa.me/${client.whatsapp_e164?.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-emerald-500 font-medium hover:underline text-right"
                    >
                      <IconWhatsapp />
                      {formatPhoneDisplay(client.whatsapp_e164)}
                    </a>
                  ) : (
                    <span className="text-muted-foreground italic text-sm text-right">
                      Não informado
                    </span>
                  )}
                </span>
              </div>

              {/* ✅ NOVO: Contato Secundário (Só aparece se existir) */}
              {(client.secondary_display_name ||
                client.secondary_phone_e164 ||
                client.secondary_whatsapp_username) && (
                <div className="bg-transparent p-3 rounded-lg border border-border mt-2 mb-2">
                  <div className="text-[10px] font-medium text-muted-foreground/60 uppercase mb-2 tracking-widest">
                    Contato Secundário
                  </div>

                  {client.secondary_display_name && (
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-muted-foreground">
                        Nome Secundário
                      </span>
                      <span className="text-xs font-medium text-foreground/90 text-right">
                        {client.secondary_display_name}
                      </span>
                    </div>
                  )}

                  {client.secondary_phone_e164 && (
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-muted-foreground">
                        WhatsApp Secundário
                      </span>
                      <a
                        href={`https://wa.me/${client.secondary_phone_e164.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-1.5 text-emerald-500 font-medium text-xs hover:underline text-right transition-all duration-300 ${valuesHidden ? "blur-sm select-none pointer-events-none" : ""}`}
                      >
                        <IconWhatsapp />
                        {client.secondary_whatsapp_username
                          ? `@${client.secondary_whatsapp_username}`
                          : formatPhoneDisplay(client.secondary_phone_e164)}
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* ✅ AJUSTE: Receber Msg? na mesma linha */}
              <div className="flex justify-between items-center py-1">
                <span className="text-muted-foreground font-medium">
                  Receber Msg?
                </span>
                {client.whatsapp_opt_in ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500 text-right">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>{" "}
                    Sim
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-500 text-right">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>{" "}
                    Não
                  </span>
                )}
              </div>

              {/* ✅ AJUSTE: Bloqueado Até na mesma linha */}
              {isMessageBlocked && (
                <div className="flex justify-between items-center py-1">
                  <span className="text-muted-foreground font-medium">
                    Bloqueado até
                  </span>
                  <span className="text-xs font-medium text-amber-500 bg-amber-500/20 px-2 py-0.5 rounded text-right">
                    {fmtDateTime(client.dont_message_until!)}
                  </span>
                </div>
              )}

              <div className="pt-2">
                <div className="text-[11px] font-medium text-muted-foreground/60 mb-1.5">
                  Observações
                </div>
                <div className="text-foreground/90 bg-transparent p-3 rounded-xl text-xs leading-relaxed border border-border min-h-[80px] whitespace-pre-wrap">
                  {client.notes ? (
                    client.notes
                  ) : (
                    <span className="italic text-muted-foreground">
                      Sem observações registradas.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 3. CARD CUPONS ELEGÍVEIS */}
          <div className="bg-card border-y sm:border border-border sm:rounded-xl p-4 shadow-sm transition-colors">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-medium text-foreground/80 uppercase tracking-widest">
                Cupons elegíveis
              </h3>
              <button
                type="button"
                onClick={() => setShowCupomModal(true)}
                className="h-7 px-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[11px] font-medium hover:bg-emerald-500/20 transition-colors"
              >
                + Cupom pessoal
              </button>
            </div>

            {loadingCoupons ? (
              <div className="text-xs text-muted-foreground py-2">
                Verificando...
              </div>
            ) : eligibleCoupons.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2 italic">
                Nenhum cupom elegível pra este cliente agora.
              </div>
            ) : (
              <div className="space-y-2">
                {eligibleCoupons.map((c) => {
                  const chips = formatCouponRuleChips(c.rule);
                  return (
                    <div
                      key={c.id}
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        c.is_bot_pick
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-border bg-transparent"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span
                            className={`font-mono ${c.is_bot_pick ? "font-bold text-emerald-500" : "font-medium text-foreground/90"}`}
                          >
                            {c.code}
                          </span>
                          <span className="text-muted-foreground ml-2">
                            {c.discount_label}
                          </span>
                          <span className="text-muted-foreground/70 ml-2">
                            {c.kind === "personal" ? "· pessoal" : "· geral"}
                          </span>
                        </div>
                        {c.is_bot_pick && (
                          <span className="shrink-0 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px] font-bold uppercase">
                            bot usa este
                          </span>
                        )}
                      </div>
                      {chips.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {chips.map((chip, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px]"
                            >
                              {chip}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-2">
              "Bot usa este" = o cupom que o bot de atendimento realmente
              ofereceria hoje via {"{cupom_frase}"} (maior desconto entre os
              visíveis pro bot). Os demais são elegíveis mas não aparecem
              sozinhos no WhatsApp.
            </p>
          </div>
        </div>

        {/* COLUNA DIREITA (TIMELINE) */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 shadow-sm h-fit transition-colors">
          <h3 className="text-[11px] font-medium text-foreground/80 uppercase mb-6 tracking-widest flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Linha do tempo
          </h3>

          <div className="space-y-0 px-2">
            {timeline.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground/60 text-sm italic border-2 border-dashed border-border rounded-xl">
                Nenhum evento registrado até o momento.
              </div>
            ) : (
              timeline.map((item, idx) => (
                <div
                  key={idx}
                  className="relative pl-8 pb-1.5 last:pb-0 border-l-2 border-border last:border-0 group"
                >
                  <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 border-card bg-muted"></div>

                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 bg-muted/50 p-2 rounded-xl border border-transparent hover:border-border transition-all">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground tracking-tight">
                        {EVENT_LABELS[item.event_type] ?? item.event_type}
                      </div>
                      <div
                        className={`text-xs text-muted-foreground mt-1.5 leading-relaxed transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                      >
                        {item.message ||
                          (item.meta ? JSON.stringify(item.meta) : "")}
                      </div>
                    </div>
                    <div className="flex items-start gap-2 shrink-0">
                      <div className="text-[10px] font-medium text-muted-foreground/60 bg-card px-2 py-1 rounded-md shadow-sm">
                        {fmtDate(item.created_at)}
                      </div>
                      <button
                        onClick={() => handleDeleteEvent(item)}
                        disabled={deletingEventId === item.id}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-500/80 hover:text-rose-500 disabled:opacity-30"
                        title="Apagar evento"
                      >
                        {deletingEventId === item.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4h6v2" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {/* --- MODAIS --- */}
      {ConfirmUI} {/* ✅ AQUI ESTÁ ELE! Agora o modal vai aparecer */}
      {/* ✅ MODAL DE AVISO DE ALERTA */}
      {showRenewWarning && client && (
        <Modal onClose={() => setShowRenewWarning(false)} maxWidth="max-w-md">
          <div className="p-6 flex flex-col gap-4">
            <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg flex gap-3">
              <span className="text-2xl">📢</span>
              <div>
                <h3 className="text-sm font-medium text-foreground mb-1">
                  Cliente com Alertas
                </h3>
                <p className="text-sm text-foreground/90">
                  O cliente{" "}
                  <strong className="text-amber-500">
                    {client.client_name}
                  </strong>{" "}
                  possui pendências em aberto.
                </p>
                <p className="text-xs text-foreground/70 mt-1">
                  Verifique os alertas antes de renovar.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowRenewWarning(false)}
                className="px-4 py-2 rounded-lg border border-border text-foreground/90 font-medium hover:bg-muted transition-colors text-xs uppercase"
              >
                Voltar
              </button>
              <button
                onClick={() => {
                  setShowRenewWarning(false);
                  setShowRenewModal(true); // Abre a renovação mesmo assim
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-colors text-xs uppercase shadow-lg shadow-emerald-900/20"
              >
                Ignorar e Renovar
              </button>
            </div>
          </div>
        </Modal>
      )}
      {showEditModal && editClientPayload && (
        <NovoCliente
          key={editClientPayload.id}
          clientToEdit={editClientPayload}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            loadData();

            // ✅ Captura toasts que o RecargaCliente mandou pra sessão
            setTimeout(() => {
              const key = "clients_list_toasts";
              const raw = window.sessionStorage.getItem(key);
              if (raw) {
                try {
                  const arr = JSON.parse(raw);
                  arr.forEach((t: any) => addToast(t.type, t.title, t.message));
                  window.sessionStorage.removeItem(key);
                } catch {}
              } else {
                // Fallback local se não tiver nada na sessão
                addToast(
                  "success",
                  "Renovação concluída",
                  "Dados atualizados com sucesso.",
                );
              }
            }, 150);
          }}
        />
      )}
      {/* ✅ MODAL TESTE RÁPIDO: cria trial novo com dados do cliente atual */}
      {showQuickTrialModal && client && (
        <NovoCliente
          mode="trial"
          defaultSendWhatsapp={false} // ✅ Não notifica o cliente no teste rápido
          sourceClientId={client.id}
          clientToEdit={{
            // ✅ SEM id: o modal entende como criação nova
            client_name: client.client_name,
            name_prefix: client.name_prefix ?? undefined,
            username: client.username,
            server_password: undefined, // ✅ Senha não vem preenchida
            created_at: client.created_at ?? undefined, // ✅ Clona a data de cadastro do cliente
            whatsapp_e164: client.whatsapp_e164 ?? undefined,
            whatsapp_username: client.whatsapp_username ?? undefined,
            whatsapp_opt_in: client.whatsapp_opt_in ?? true,
            secondary_display_name: client.secondary_display_name ?? undefined,
            secondary_name_prefix: client.secondary_name_prefix ?? undefined,
            secondary_phone_e164: client.secondary_phone_e164 ?? undefined,
            secondary_whatsapp_username:
              client.secondary_whatsapp_username ?? undefined,
            // ✅ servidor em branco: força o usuário escolher outro
            server_id: "",
            screens: 1,
            technology: client.technology ?? undefined,
            plan_name: client.plan_name ?? undefined,
            price_amount: client.price_amount ?? undefined,
            price_currency: client.price_currency ?? undefined,
            plan_table_id: (client as any).plan_table_id ?? null,
            plan_table_name: (client as any).plan_table_name ?? null,
          }}
          onClose={() => setShowQuickTrialModal(false)}
          onSuccess={() => {
            setShowQuickTrialModal(false);
            // ✅ Redireciona para tela de testes filtrada pelo nome do cliente
            // Filtra por nome (nunca muda, mesmo que o username seja alterado pelo servidor)
            window.location.href = `/admin/teste?search=${encodeURIComponent(client.client_name)}`;
          }}
        />
      )}
      {showRenewModal && client && (
        <RecargaCliente
          clientId={client.id}
          clientName={client.client_name}
          onClose={() => setShowRenewModal(false)}
          onSuccess={() => {
            // ✅ Fechava o modal errado (showEditModal, que nem estava
            // aberto) — o modal de renovação em si (showRenewModal) ficava
            // na tela até o usuário clicar em fechar manualmente.
            setShowRenewModal(false);
            loadData();

            // ✅ Lê o toast real que o RecargaCliente já coloca no
            // sessionStorage (mesma mensagem específica que a lista de
            // Clientes/Testes mostra) em vez de dois toasts genéricos
            // fixos — mesmo padrão já usado pelo NovoCliente logo acima.
            setTimeout(() => {
              const key = "clients_list_toasts";
              const raw = window.sessionStorage.getItem(key);
              if (raw) {
                try {
                  const arr = JSON.parse(raw);
                  arr.forEach((t: any) => addToast(t.type, t.title, t.message));
                  window.sessionStorage.removeItem(key);
                } catch {}
              } else {
                addToast(
                  "success",
                  "Renovação confirmada",
                  "Pagamento salvo e data atualizada.",
                );
              }
            }, 150);
          }}
        />
      )}
      {showCupomModal && client && (
        <CupomModal
          lockedClient={{
            id: client.id,
            display_name: client.client_name,
            username: client.username,
          }}
          onClose={() => setShowCupomModal(false)}
          onSuccess={() => {
            setShowCupomModal(false);
            addToast("success", "Cupom criado", `Cupom pessoal criado para ${client.client_name}.`);
            loadEligibleCoupons(client.id);
          }}
          onError={(msg) => addToast("error", "Erro ao salvar cupom", msg)}
        />
      )}
      {expandedAppIcon && (
        <div
          className="fixed inset-0 z-[999998] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          onClick={() => setExpandedAppIcon(null)}
        >
          <div className="flex flex-col items-center gap-3">
            <img
              src={expandedAppIcon.url}
              alt=""
              className="w-40 h-40 sm:w-56 sm:h-56 rounded-2xl object-cover shadow-2xl"
            />
            <span className="text-sm font-medium text-white/90">
              {expandedAppIcon.name}
            </span>
          </div>
        </div>
      )}
      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

// --- ÍCONES ---
function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
function IconMoney() {
  return <CreditCard className="w-4 h-4" />;
}
function IconTrash() {
  return <Trash2 className="w-4 h-4" />;
}
function IconRestore() {
  return <RefreshCcw className="w-4 h-4" />;
}
function IconWhatsapp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
function IconLoading() {
  return <Loader2 className="w-4 h-4 animate-spin" />;
}
function IconFastTimer() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Linhas de movimento */}
      <line x1="2" y1="13" x2="5" y2="13" />
      <line x1="3" y1="9" x2="6" y2="9" />
      {/* O cronômetro */}
      <circle cx="13" cy="13" r="7" />
      <polyline points="13 10 13 13 15 15" />
      <line x1="10" y1="3" x2="16" y2="3" />
    </svg>
  );
}

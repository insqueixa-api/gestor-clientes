"use client";
// app/admin/settings/cupons/page.tsx
import { Pencil, Play, Pause, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";

import { useEffect, useState } from "react";
import type { ReactNode, MouseEvent } from "react";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, {
  ToastMessage,
} from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import CupomModal, { CouponEditPayload } from "./cupom_modal";
import { computeCouponImpact, ImpactResult } from "./impact_preview";

export type CouponRow = {
  id: string;
  tenant_id: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  currency: string | null;
  starts_at: string | null;
  ends_at: string | null;
  max_total_redemptions: number | null;
  is_active: boolean;
  message_template: string | null;
  created_at: string;
  client_id: string | null;
  clients: { display_name: string | null; username: string | null } | null;
  target_status: string[] | null;
  target_server_ids: string[] | null;
  target_plan_labels: string[] | null;
  target_app_names: string[] | null;
  rule_date_field: "vencimento" | "cadastro" | null;
  rule_days_min: number | null;
  rule_days_max: number | null;
};

function fmtMoney(value: number) {
  return `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CuponsPage() {
  const [loading, setLoading] = useState(true);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [redemptionCounts, setRedemptionCounts] = useState<Record<string, number>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<CouponEditPayload | null>(null);
  const [impactCoupon, setImpactCoupon] = useState<CouponRow | null>(null);
  const [usageCoupon, setUsageCoupon] = useState<CouponRow | null>(null);

  const { confirm, ConfirmUI } = useConfirm();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 5000);
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function fetchData() {
    try {
      setLoading(true);
      const tenantId = await getCurrentTenantId();
      if (!tenantId) {
        setLoading(false);
        return;
      }

      const [couponsRes, redemptionsRes] = await Promise.all([
        supabaseBrowser
          .from("coupons")
          .select("*, clients(display_name, username:server_username)")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabaseBrowser
          .from("coupon_redemptions")
          .select("coupon_id")
          .eq("tenant_id", tenantId),
      ]);

      if (couponsRes.error) throw couponsRes.error;
      setCoupons((couponsRes.data as CouponRow[]) || []);

      const counts: Record<string, number> = {};
      for (const row of (redemptionsRes.data as { coupon_id: string }[]) || []) {
        counts[row.coupon_id] = (counts[row.coupon_id] || 0) + 1;
      }
      setRedemptionCounts(counts);
    } catch (e: any) {
      addToast("error", "Erro ao carregar", e?.message ?? "Falha ao carregar cupons.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formatDiscount(row: CouponRow) {
    if (row.discount_type === "percent") {
      return `${String(Number(row.discount_value)).replace(".", ",")}%`;
    }
    return `R$ ${Number(row.discount_value).toFixed(2).replace(".", ",")}`;
  }

  function formatDate(d: string | null) {
    if (!d) return null;
    return new Date(d).toLocaleDateString("pt-BR");
  }

  function validityLabel(row: CouponRow) {
    if (!row.starts_at && !row.ends_at) return "Sem validade";
    const start = formatDate(row.starts_at);
    const end = formatDate(row.ends_at);
    if (start && end) return `${start} até ${end}`;
    if (end) return `Até ${end}`;
    if (start) return `A partir de ${start}`;
    return "Sem validade";
  }

  function isExpired(row: CouponRow) {
    return !!row.ends_at && new Date(row.ends_at) < new Date();
  }

  function ruleSummary(row: CouponRow): string {
    if (row.client_id) return "Cupom pessoal";
    const parts: string[] = [];
    if (row.target_status?.length) parts.push(`Status (${row.target_status.length})`);
    if (row.target_server_ids?.length) parts.push(`Servidor (${row.target_server_ids.length})`);
    if (row.target_plan_labels?.length) parts.push(`Plano (${row.target_plan_labels.length})`);
    if (row.target_app_names?.length) parts.push(`App (${row.target_app_names.length})`);
    if (row.rule_date_field) parts.push(row.rule_date_field === "vencimento" ? "Vencimento" : "Cadastro");
    return parts.length ? parts.join(" · ") : "Sem restrição";
  }

  async function handleToggleActive(row: CouponRow) {
    try {
      const { error } = await supabaseBrowser
        .from("coupons")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
      addToast("success", row.is_active ? "Desativado" : "Ativado");
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro", e?.message ?? "Falha ao atualizar cupom.");
    }
  }

  async function handleDelete(row: CouponRow) {
    const ok = await confirm({
      title: "Remover cupom?",
      subtitle: `Deseja remover o cupom "${row.code}"?`,
      tone: "rose",
      confirmText: "Remover",
      cancelText: "Voltar",
      details: [
        "O cupom deixa de funcionar imediatamente.",
        "O histórico de usos anteriores é mantido.",
      ],
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser.from("coupons").delete().eq("id", row.id);
      if (error) throw error;
      addToast("success", "Removido", "Cupom removido com sucesso.");
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro ao remover", e?.message ?? "Falha ao remover cupom.");
    }
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
            Cupons de Desconto
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Cupons usados na renovação pelo portal do cliente.
          </p>
        </div>

        <button
          onClick={() => {
            setEditingCoupon(null);
            setIsModalOpen(true);
          }}
          className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all shrink-0"
          type="button"
        >
          <span>+</span> Novo Cupom
        </button>
      </div>

      {loading && (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-xl border border-border">
          Carregando cupons...
        </div>
      )}

      {!loading && coupons.length === 0 && (
        <div className="p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
          Nenhum cupom cadastrado ainda.
        </div>
      )}

      {!loading && coupons.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-5">
          {coupons.map((row) => {
            const expired = isExpired(row);
            const usedCount = redemptionCounts[row.id] || 0;
            return (
              <div
                key={row.id}
                className="rounded-none sm:rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-card border-border hover:border-emerald-500/30"
              >
                <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-b border-border bg-transparent">
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <h2
                        className="text-base font-mono font-medium truncate text-foreground/90 tracking-tight"
                        title={row.code}
                      >
                        {row.code}
                      </h2>

                      <span className="inline-flex items-center text-[10px] font-medium bg-sky-500/10 text-sky-500 border border-sky-500/20 px-2.5 py-0.5 rounded-full uppercase">
                        {formatDiscount(row)}
                      </span>

                      {!row.is_active && (
                        <span className="inline-flex items-center text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase">
                          Inativo
                        </span>
                      )}
                      {row.is_active && expired && (
                        <span className="inline-flex items-center text-[10px] font-medium bg-rose-500/10 text-rose-500 border border-rose-500/20 px-2.5 py-0.5 rounded-full uppercase">
                          Expirado
                        </span>
                      )}
                      {row.client_id && (
                        <span
                          className="inline-flex items-center text-[10px] font-medium bg-purple-500/10 text-purple-500 border border-purple-500/20 px-2.5 py-0.5 rounded-full truncate max-w-[160px]"
                          title={row.clients?.display_name || undefined}
                        >
                          👤 {row.clients?.display_name || "Cliente removido"}
                        </span>
                      )}
                    </div>
                    {row.description && (
                      <p className="text-xs text-muted-foreground mt-1 truncate" title={row.description}>
                        {row.description}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <IconActionBtn
                      title="Editar"
                      tone="amber"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCoupon(row);
                        setIsModalOpen(true);
                      }}
                    >
                      <Pencil className="w-4 h-4" />
                    </IconActionBtn>

                    <IconActionBtn
                      title={row.is_active ? "Desativar" : "Ativar"}
                      tone={row.is_active ? "red" : "green"}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleActive(row);
                      }}
                    >
                      {row.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </IconActionBtn>

                    <IconActionBtn
                      title="Remover"
                      tone="red"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(row);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </IconActionBtn>
                  </div>
                </div>

                <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">📅 Validade</span>
                      <span className="font-medium text-foreground/90 text-right">
                        {validityLabel(row)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">🎯 Regra</span>
                      <span
                        className="font-medium text-foreground/90 text-right truncate max-w-[160px]"
                        title={ruleSummary(row)}
                      >
                        {ruleSummary(row)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 sm:border-l sm:pl-4 border-border">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">🧾 Usos</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUsageCoupon(row);
                        }}
                        className="font-medium text-sky-500 hover:underline"
                      >
                        {row.client_id
                          ? row.is_active
                            ? "Disponível"
                            : "Usado — reative"
                          : row.max_total_redemptions != null
                            ? `${usedCount} / ${row.max_total_redemptions}`
                            : `${usedCount}`}
                      </button>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">💬 Frase</span>
                      <span className="font-medium text-foreground/90">
                        {row.message_template ? "Customizada" : "Padrão"}
                      </span>
                    </div>
                  </div>
                </div>

                {!row.client_id && (
                  <div className="px-4 sm:px-5 pb-4 sm:pb-5">
                    <button
                      type="button"
                      onClick={() => setImpactCoupon(row)}
                      className="w-full h-8 rounded-lg text-xs font-medium border border-sky-500/30 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 transition-colors"
                    >
                      🎯 Ver clientes impactados
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isModalOpen && (
        <CupomModal
          coupon={editingCoupon}
          onClose={() => {
            setIsModalOpen(false);
            setEditingCoupon(null);
          }}
          onSuccess={() => {
            setIsModalOpen(false);
            setEditingCoupon(null);
            addToast("success", "Salvo", "Cupom salvo com sucesso.");
            fetchData();
          }}
          onError={(msg) => addToast("error", "Erro", msg)}
        />
      )}

      {impactCoupon && (
        <ImpactListModal coupon={impactCoupon} onClose={() => setImpactCoupon(null)} />
      )}

      {usageCoupon && (
        <UsageLogModal coupon={usageCoupon} onClose={() => setUsageCoupon(null)} />
      )}

      {ConfirmUI}

      <div className="h-24 md:h-20" />

      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

function IconActionBtn({
  children,
  title,
  tone,
  onClick,
}: {
  children: ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const colors = {
    blue: "text-sky-500 bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20",
    green: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20",
    amber: "text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
    purple: "text-purple-500 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20",
    red: "text-rose-500 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
  };

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={title}
      className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}
      type="button"
    >
      {children}
    </button>
  );
}

/** Prévia de impacto direto na listagem — usa as regras já SALVAS do cupom (sem precisar abrir o modal de edição). */
function ImpactListModal({ coupon, onClose }: { coupon: CouponRow; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ImpactResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const tenantId = await getCurrentTenantId();
        if (!tenantId) throw new Error("Tenant não encontrado.");
        const r = await computeCouponImpact({
          tenantId,
          discountType: coupon.discount_type,
          discountValue: Number(coupon.discount_value),
          excludeCouponId: coupon.id,
          targetStatus: coupon.target_status,
          targetServerIds: coupon.target_server_ids,
          targetPlanLabels: coupon.target_plan_labels,
          targetAppNames: coupon.target_app_names,
          ruleDateField: coupon.rule_date_field,
          ruleDaysMin: coupon.rule_days_min,
          ruleDaysMax: coupon.rule_days_max,
        });
        if (alive) setResult(r);
      } catch (e: any) {
        if (alive) setError(e?.message || "Falha ao calcular impacto.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [coupon.id]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-border flex justify-between items-center shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-medium text-foreground">Clientes impactados</h3>
            <p className="text-xs text-muted-foreground font-mono">{coupon.code}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <div className="text-center text-muted-foreground text-sm py-8">Calculando...</div>}
          {error && <p className="text-rose-500 text-sm">{error}</p>}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm bg-muted/50 rounded-lg px-3 py-2.5">
                <span className="text-muted-foreground">
                  {result.totalClients} cliente(s) — estimativa em BRL
                </span>
                <span className="font-medium text-foreground/90">
                  {fmtMoney(result.totalNormal)} →{" "}
                  <span className="text-emerald-500">{fmtMoney(result.totalDiscounted)}</span>
                </span>
              </div>

              {result.clients.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Nenhum cliente elegível hoje.
                </p>
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border">
                  {result.clients.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <span className="text-foreground/90 truncate">
                        {c.name} <span className="text-muted-foreground">({c.username})</span>
                      </span>
                      <span className="text-muted-foreground shrink-0 ml-2">
                        {fmtMoney(c.normalPrice)} →{" "}
                        <span className="text-emerald-500">{fmtMoney(c.discountedPrice)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

type RedemptionRow = {
  id: string;
  discount_amount: number;
  currency: string;
  created_at: string;
  clients: { display_name: string | null; username: string | null } | null;
};

/** Log de uso do cupom (coupon_redemptions) — fica pronto mas vazio até a Fase 2 gravar os resgates. */
function UsageLogModal({ coupon, onClose }: { coupon: CouponRow; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RedemptionRow[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabaseBrowser
        .from("coupon_redemptions")
        .select("id, discount_amount, currency, created_at, clients(display_name, username:server_username)")
        .eq("coupon_id", coupon.id)
        .order("created_at", { ascending: false });
      if (!alive) return;
      setRows((data as any[]) || []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [coupon.id]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-border flex justify-between items-center shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-medium text-foreground">Log de uso</h3>
            <p className="text-xs text-muted-foreground font-mono">{coupon.code}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <div className="text-center text-muted-foreground text-sm py-8">Carregando...</div>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum uso registrado ainda.
            </p>
          )}
          {!loading && rows.length > 0 && (
            <div className="rounded-lg border border-border divide-y divide-border">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="text-foreground/90 truncate">
                    {r.clients?.display_name || "—"}{" "}
                    <span className="text-muted-foreground">({r.clients?.username || "—"})</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 ml-2">
                    {new Date(r.created_at).toLocaleString("pt-BR")} · {fmtMoney(Number(r.discount_amount))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

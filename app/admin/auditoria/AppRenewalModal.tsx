"use client";
// app/admin/auditoria/AppRenewalModal.tsx
//
// Painel "Concluir renovação de licença" — pedido do Márcio (28/07/2026).
// Pagamento de licença de app (payment_type='app_renewal') é aprovado
// automático (MP/Stripe), mas a renovação de verdade fica pendente
// (fulfillment_status='manual_pending', ver markAppRenewalPaid em
// lib/client-portal/fulfillment.ts) até o Márcio confirmar aqui — o
// dinheiro que o cliente paga é a margem/taxa; a licença de verdade é paga
// direto ao desenvolvedor do app, por fora do sistema. Fluxo:
//   1. Márcio paga a licença de verdade ao desenvolvedor (fora daqui).
//   2. Clica "Atualizar" — consulta o vencimento real no painel do
//      parceiro (mesma ação "Verificar validade" do app).
//   3. Confere/ajusta a data manualmente se quiser (ou se o app não tem
//      integração automática).
//   4. "Salvar" grava o vencimento no app do cliente e conclui a
//      pendência. "Cancelar renovação" encerra sem mexer em nada — pro
//      caso de não ser uma renovação de verdade (cobrança duplicada etc).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ToastFn = (type: "success" | "error" | "warning", title: string, message?: string) => void;

type LoadedData = {
  clientName: string;
  serverUsername: string;
  serverName: string;
  appName: string;
  macValue: string;
  deviceKey: string;
  oldExpireDate: string | null;
  hasIntegration: boolean;
};

export default function AppRenewalModal({
  clientAppId,
  paymentLogId,
  tenantId,
  onClose,
  onSaved,
  onCancelled,
  addToast,
}: {
  clientAppId: string;
  paymentLogId: string;
  tenantId: string;
  onClose: () => void;
  onSaved: () => void;
  onCancelled: () => void;
  addToast: ToastFn;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LoadedData | null>(null);
  const [newDate, setNewDate] = useState("");
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: row } = await supabaseBrowser
        .from("client_apps")
        .select(
          "field_values, clients(display_name, server_username, server_id, servers(name)), apps(name, integration_type, fields_config)",
        )
        .eq("id", clientAppId)
        .maybeSingle();

      if (!row) {
        setLoading(false);
        return;
      }

      const vals = (row as any).field_values || {};
      const config: any[] = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];
      const macField = config.find((f: any) => f.type === "mac");
      const keyField = config.find((f: any) => f.type === "device_key");
      const dateField = config.find((f: any) => f.type === "date");
      const macValue = macField ? String(vals[macField.id] ?? vals[macField.label] ?? "") : "";
      const deviceKey = keyField ? String(vals[keyField.id] ?? vals[keyField.label] ?? "") : "";
      const oldExpireDateRaw = dateField ? (vals[dateField.id] ?? vals[dateField.label] ?? null) : null;
      const oldExpireDate = oldExpireDateRaw ? String(oldExpireDateRaw).split("T")[0] : null;

      setData({
        clientName: (row as any).clients?.display_name || "Cliente",
        serverUsername: (row as any).clients?.server_username || "",
        serverName: (row as any).clients?.servers?.name || "",
        appName: (row as any).apps?.name || "Aplicativo",
        macValue,
        deviceKey,
        oldExpireDate,
        hasIntegration: !!(row as any).apps?.integration_type,
      });
      setNewDate(oldExpireDate || "");
      setLoading(false);
    }
    load();
  }, [clientAppId]);

  async function handleCheck() {
    setChecking(true);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/admin/apps/check-validity", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao verificar.");
      if (result.expireDate) {
        setNewDate(String(result.expireDate).split("T")[0]);
        addToast("success", "Vencimento encontrado!", `Novo vencimento: ${String(result.expireDate).split("T")[0].split("-").reverse().join("/")}`);
      } else {
        addToast("warning", "Não encontrado", "O painel do parceiro não devolveu um vencimento — confira manualmente ou digite a data.");
      }
    } catch (e: any) {
      addToast("error", "Falha ao verificar", e?.message);
    } finally {
      setChecking(false);
    }
  }

  async function handleSave() {
    if (!newDate) {
      addToast("warning", "Data obrigatória", "Preencha o novo vencimento antes de salvar.");
      return;
    }
    setSaving(true);
    try {
      const { data: row, error: rowErr } = await supabaseBrowser
        .from("client_apps")
        .select("field_values, apps(fields_config)")
        .eq("id", clientAppId)
        .single();
      if (rowErr || !row) throw new Error("Aplicativo não encontrado.");

      const config: any[] = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];
      const dateField = config.find((f: any) => f.type === "date");
      if (!dateField) throw new Error("Esse app não tem campo de vencimento configurado.");
      const fieldKey = String(dateField.id || dateField.label);
      const nextVals = { ...(row.field_values || {}), [fieldKey]: newDate };

      const { error: updErr } = await supabaseBrowser.from("client_apps").update({ field_values: nextVals }).eq("id", clientAppId);
      if (updErr) throw updErr;

      const { error: rpcErr } = await supabaseBrowser.rpc("update_fulfillment_status", {
        p_log_id: paymentLogId,
        p_tenant_id: tenantId,
        p_status: "manual_done",
      });
      if (rpcErr) throw rpcErr;

      addToast("success", "Renovação concluída!", "Vencimento atualizado e pendência resolvida.");
      onSaved();
    } catch (e: any) {
      addToast("error", "Falha ao salvar", e?.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const { error } = await supabaseBrowser.rpc("update_fulfillment_status", {
        p_log_id: paymentLogId,
        p_tenant_id: tenantId,
        p_status: "manual_cancelled",
      });
      if (error) throw error;
      addToast("success", "Cancelado", "Renovação cancelada — vencimento não foi alterado.");
      onCancelled();
    } catch (e: any) {
      addToast("error", "Falha ao cancelar", e?.message);
    } finally {
      setCancelling(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200"
      >
        <h3 className="text-lg font-bold text-foreground mb-4">Concluir renovação de licença</h3>

        {loading || !data ? (
          <div className="py-8 text-center text-muted-foreground animate-pulse">Carregando...</div>
        ) : (
          <div className="space-y-3 text-sm">
            <Row label="Nome do cliente" value={data.clientName} />
            <Row label="Servidor" value={`${data.serverUsername || "—"}${data.serverName ? ` (${data.serverName})` : ""}`} />
            <Row label="Aplicativo renovado" value={data.appName} />
            <Row label="Device ID" value={data.macValue || "—"} />
            <Row label="Device Key" value={data.deviceKey || "—"} />
            <Row
              label="Vencimento (antigo)"
              value={data.oldExpireDate ? data.oldExpireDate.split("-").reverse().join("/") : "—"}
            />

            <div className="pt-2 border-t border-border">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Novo vencimento</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="flex-1 h-10 px-3 bg-muted border border-border rounded-lg text-sm text-foreground outline-none focus:border-sky-500"
                />
                {data.hasIntegration && (
                  <button
                    type="button"
                    disabled={checking}
                    onClick={handleCheck}
                    className="h-10 px-3 rounded-lg bg-sky-500/10 text-sky-500 border border-sky-500/20 text-xs font-bold hover:bg-sky-500/20 disabled:opacity-50 shrink-0"
                  >
                    {checking ? "..." : "Atualizar"}
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-3">
              <button
                disabled={saving || cancelling}
                onClick={handleSave}
                className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
              <button
                disabled={saving || cancelling}
                onClick={handleCancel}
                className="flex-1 h-10 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 text-xs font-bold disabled:opacity-50"
              >
                {cancelling ? "Cancelando..." : "Cancelar renovação"}
              </button>
            </div>
            <button onClick={onClose} className="w-full text-xs text-muted-foreground hover:text-foreground pt-1 transition-colors">
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  );
}

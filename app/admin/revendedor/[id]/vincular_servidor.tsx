"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";

// Tipos
type ServerOption = {
  id: string;
  name: string;
  default_currency?: string | null;
};

// Interface
interface Props {
  resellerId: string;

  // Quando editar:
  resellerServerId?: string | null;
  initial?: {
    server_id: string | null;
    server_username: string | null;
    server_password: string | null;
    unit_price_override?: number | null;
  };

  onClose: () => void;
  onSaved: () => void;
  onError?: (msg: string) => void;
}

// --- HELPERS VISUAIS ---
// Exibe: 10.5 -> "10,50"
function toMoneyInput(n: number | null | undefined) {
  if (n === null || n === undefined) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Salva: "1.000,50" -> 1000.5
function fromMoneyInput(s: string) {
  if (!s) return null;
  const clean = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

// Componentes
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight">
      {children}
    </label>
  );
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20 outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Select({ children, className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    >
      {children}
    </select>
  );
}

export default function VincularServidor({
  resellerId,
  resellerServerId = null,
  initial,
  onClose,
  onSaved,
  onError,
}: Props) {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loadingServers, setLoadingServers] = useState(true);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const isEdit = !!resellerServerId;

  // Estados do Formulário
  const [serverId, setServerId] = useState<string>(initial?.server_id ?? "");
  const [username, setUsername] = useState<string>(initial?.server_username ?? "");
  const [password, setPassword] = useState<string>(initial?.server_password ?? "");

  // Preço Personalizado (String visual)
  const [priceOverride, setPriceOverride] = useState<string>(
    initial?.unit_price_override != null ? toMoneyInput(initial.unit_price_override) : ""
  );

  // 1. Carregar lista de servidores
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoadingServers(true);
        setLoadErr(null);

        const tid = await getCurrentTenantId();
        if (!alive) return;
        setTenantId(tid);

        // Busca servidores direto do banco
        const { data, error } = await supabaseBrowser
          .from("servers")
          .select("id, name, default_currency")
          .eq("tenant_id", tid)
          .eq("is_archived", false)
          .order("name");

        if (error) throw new Error(error.message);

        if (!alive) return;
        setServers((data || []) as ServerOption[]);
      } catch (e: any) {
        if (!alive) return;
        setLoadErr(e?.message || "Erro ao carregar servidores");
      } finally {
        if (alive) setLoadingServers(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const canSave = useMemo(() => {
    if (!serverId) return false;
    if (!username || !username.trim()) return false;
    return true;
  }, [serverId, username]);

  // 2. Salvar Vínculo (INSERT/UPDATE direto)
  async function onSave() {
    if (!tenantId) return;
    if (!canSave || saving) return;

    setSaving(true);

    try {
      const finalPrice = priceOverride ? fromMoneyInput(priceOverride) : null;

      if (isEdit) {
        // --- EDITAR: Update direto na tabela ---
        const { error } = await supabaseBrowser
          .from("reseller_servers")
          .update({
            server_username: username.trim(),
            server_password: password.trim() || null,
            unit_price_override: finalPrice,
          })
          .eq("id", resellerServerId)
          .eq("tenant_id", tenantId)
          .eq("reseller_id", resellerId);

        if (error) throw error;
      } else {
        // --- CRIAR: Insert direto (evita 42P10 da RPC com ON CONFLICT incorreto) ---
        const { error } = await supabaseBrowser.from("reseller_servers").insert({
          tenant_id: tenantId,
          reseller_id: resellerId,
          server_id: serverId,
          server_username: username.trim(),
          server_password: password.trim() || null,
          unit_price_override: finalPrice,
        });

        if (error) throw error;
      }

      onSaved();
      onClose();
    } catch (e: any) {
      console.error("Erro ao salvar:", e);

      // Duplicidade (unique constraint)
      if (e?.code === "23505") {
        const msg = "Já existe um vínculo com este servidor e este usuário para esta revenda.";
        if (onError) onError(msg);
        else alert(msg);
      } else {
        const msg = e?.message || "Erro desconhecido ao salvar.";
        if (onError) onError(msg);
        else alert(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors">
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
            {isEdit ? "Editar Vínculo" : "Vincular Servidor"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-6 overflow-y-auto bg-white dark:bg-[#161b22]">
          {loadErr && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm font-medium animate-in slide-in-from-top-2">
              <span className="font-bold">Erro:</span> {loadErr}
            </div>
          )}

          {loadingServers ? (
            <div className="py-12 text-center text-slate-400 dark:text-white/20 animate-pulse font-medium">
              Carregando servidores...
            </div>
          ) : (
            <div className="space-y-4">
              {/* Servidor */}
              <div>
                <Label>Servidor</Label>
                <Select
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                  disabled={loadingServers || isEdit}
                >
                  <option value="">Selecione o servidor...</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Grid User/Pass */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Usuário no Painel</Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ex: revenda_joao"
                    type="text"
                    autoComplete="off"
                  />
                </div>

                <div>
                  <Label>Senha (Opcional)</Label>
                  <Input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="********"
                    type="text"
                    autoComplete="off"
                  />
                </div>
              </div>
              
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex items-center justify-end gap-3 transition-colors">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 text-sm font-semibold transition-colors"
          >
            Cancelar
          </button>

          <button
            onClick={onSave}
            disabled={!canSave || saving}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all shadow-lg shadow-emerald-900/20 ${
              !canSave || saving
                ? "bg-emerald-600/50 text-white/70 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}
          >
            {saving ? "Salvando..." : isEdit ? "Salvar alterações" : "Vincular"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

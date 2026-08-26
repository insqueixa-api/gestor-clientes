"use client";
// app/admin/gerenciador/aplicativo/gpc_roku_activations_modal.tsx
//
// Painel de gerenciamento dos MACs do GPC Roku (achado 26/08/2026, pedido
// do Márcio — ver docs/sql/gpc_roku_activations.sql): único membro cobrado
// da família GerenciaApp, ele quem controla ativação/validade, não o
// parceiro. Aberto pela engrenagem no card do GPC Roku (aplicativo/
// page.tsx). Lista todos os MACs registrados (quando, quem fez, cliente,
// usuário/servidor, validade) + cadastra/edita/remove manualmente — pra
// quando o cliente paga por fora do Portal ou o Márcio precisa corrigir
// algo. Escrita direta via supabaseBrowser (RLS tenant_isolation, mesmo
// padrão de app_integrations/api_integrations) — sem rota de API própria,
// é puro CRUD igual outras telas de settings deste projeto.
//
// ⚠️ Este painel NUNCA chama o painel real do GerenciaApp — só mexe no
// nosso registro. O vencimento de verdade só é empurrado pro parceiro
// quando o MAC é (re)configurado normalmente (lib/apps/orchestration.ts já
// lê esse registro nessa hora) ou via o botão "Marcar pago" na tela do
// cliente (que aciona lib/apps/gpc-roku-registry.ts's renewGpcRokuTenYears).
import { useEffect, useRef, useState } from "react";
import { Search, X, Pencil, Trash2, Plus } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/hooks/useConfirm";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { Dropdown } from "@/components/ui/Dropdown";
import FormattedDateInput from "@/components/ui/FormattedDateInput";

type PickedClient = { id: string; display_name: string; username: string | null };

type ActivationRow = {
  id: string;
  mac: string;
  client_id: string | null;
  client_app_id: string | null;
  status: "trial" | "paid";
  valid_until: string;
  activated_by: string | null;
  activated_at: string;
  clients: {
    display_name: string;
    server_username: string;
    servers: { name: string } | { name: string }[] | null;
  } | null;
};

function formatDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeMac(mac: string): string {
  return mac.trim().toUpperCase();
}

function ClientPickerLocal({
  tenantId,
  selected,
  onSelect,
  onClear,
}: {
  tenantId: string;
  selected: PickedClient | null;
  onSelect: (client: PickedClient) => void;
  onClear: () => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PickedClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await supabaseBrowser
          .from("clients")
          .select("id, display_name, username:server_username")
          .eq("tenant_id", tenantId)
          .eq("is_archived", false)
          .or(`display_name.ilike.%${q}%,server_username.ilike.%${q}%`)
          .limit(8);
        setResults((data as PickedClient[]) || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, tenantId]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 h-10 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3">
        <span className="text-sm font-medium text-foreground/90 truncate">
          {selected.display_name}
          {selected.username ? <span className="text-muted-foreground"> ({selected.username})</span> : null}
        </span>
        <button type="button" onClick={onClear} className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Buscar cliente por nome ou usuário..."
          className="w-full h-10 rounded-xl border border-border bg-transparent pl-9 pr-3 text-sm text-foreground/90 outline-none focus:ring-2 focus:ring-emerald-500/30"
        />
      </div>
      <Dropdown open={open && (loading || results.length > 0)} onClose={() => setOpen(false)} triggerRef={wrapperRef} align="left" matchTriggerWidth className="max-h-56 overflow-y-auto">
        {loading && <div className="px-3 py-2.5 text-xs text-muted-foreground">Buscando...</div>}
        {!loading &&
          results.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(c);
                setTerm("");
                setResults([]);
                setOpen(false);
              }}
              className="w-full px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors border-b border-border last:border-b-0"
            >
              <span className="font-medium text-foreground/90">{c.display_name}</span>
              {c.username && <span className="text-muted-foreground"> ({c.username})</span>}
            </button>
          ))}
      </Dropdown>
    </div>
  );
}

export default function GpcRokuActivationsModal({
  tenantId,
  onClose,
}: {
  tenantId: string;
  onClose: () => void;
}) {
  const { confirm, ConfirmUI } = useConfirm();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const addToast = (type: ToastMessage["type"], title: string, message?: string) =>
    setToasts((prev) => [...prev, { id: Date.now(), type, title, message }]);
  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const [rows, setRows] = useState<ActivationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [pickedClient, setPickedClient] = useState<PickedClient | null>(null);
  const [macInput, setMacInput] = useState("");
  const [statusInput, setStatusInput] = useState<"trial" | "paid">("paid");
  const [validUntilInput, setValidUntilInput] = useState("");

  async function fetchRows() {
    setLoading(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("gpc_roku_activations")
        .select("id, mac, client_id, client_app_id, status, valid_until, activated_by, activated_at, clients(display_name, server_username, servers(name))")
        .eq("tenant_id", tenantId)
        .order("activated_at", { ascending: false });
      if (error) throw error;
      setRows((data as any[]) || []);
    } catch (e: any) {
      addToast("error", "Erro", e?.message || "Falha ao carregar os registros.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRows();
  }, [tenantId]);

  function resetForm() {
    setPickedClient(null);
    setMacInput("");
    setStatusInput("paid");
    setValidUntilInput("");
    setShowAddForm(false);
    setEditingId(null);
  }

  function openAddForm() {
    resetForm();
    const target = new Date();
    target.setFullYear(target.getFullYear() + 10);
    setValidUntilInput(formatDateOnly(target));
    setShowAddForm(true);
  }

  function openEditForm(row: ActivationRow) {
    setEditingId(row.id);
    setShowAddForm(true);
    setMacInput(row.mac);
    setStatusInput(row.status);
    setValidUntilInput(row.valid_until);
    setPickedClient(
      row.client_id && row.clients
        ? { id: row.client_id, display_name: row.clients.display_name, username: row.clients.server_username }
        : null,
    );
  }

  async function handleSave() {
    const mac = normalizeMac(macInput);
    if (!mac) {
      addToast("error", "Erro", "Informe o MAC.");
      return;
    }
    if (!validUntilInput) {
      addToast("error", "Erro", "Informe a validade.");
      return;
    }

    setSaving(true);
    try {
      const { data: sess } = await supabaseBrowser.auth.getUser();
      const activatedBy = sess?.user?.email || null;

      if (editingId) {
        const { error } = await supabaseBrowser
          .from("gpc_roku_activations")
          .update({
            client_id: pickedClient?.id ?? null,
            status: statusInput,
            valid_until: validUntilInput,
            activated_by: activatedBy,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingId)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        addToast("success", "Atualizado", "Registro salvo.");
      } else {
        const { error } = await supabaseBrowser.from("gpc_roku_activations").upsert(
          {
            tenant_id: tenantId,
            mac,
            client_id: pickedClient?.id ?? null,
            status: statusInput,
            valid_until: validUntilInput,
            activated_by: activatedBy,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,mac" },
        );
        if (error) throw error;
        addToast("success", "Cadastrado", "MAC registrado — o vencimento real no GerenciaApp é aplicado na próxima configuração desse MAC, ou pelo botão \"Marcar pago\" na tela do cliente.");
      }

      resetForm();
      fetchRows();
    } catch (e: any) {
      addToast("error", "Erro", e?.message || "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: ActivationRow) {
    const ok = await confirm({
      title: "Remover este registro?",
      subtitle: `MAC ${row.mac} deixa de ter validade controlada — a próxima configuração vai tratá-lo como MAC novo (trial de 7 dias).`,
      tone: "rose",
      confirmText: "Sim, remover",
      cancelText: "Cancelar",
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser.from("gpc_roku_activations").delete().eq("id", row.id).eq("tenant_id", tenantId);
      if (error) throw error;
      addToast("success", "Removido", "Registro removido.");
      fetchRows();
    } catch (e: any) {
      addToast("error", "Erro", e?.message || "Falha ao remover.");
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <ModalHeader onClose={onClose}>
        <h2 className="text-lg font-medium text-foreground tracking-tight">GPC Roku — MACs ativados</h2>
        <div className="text-xs text-muted-foreground mt-0.5">
          Validade controlada por MAC — trial de 7 dias em MAC novo, 10 anos ao pagar.
        </div>
      </ModalHeader>

      <ModalBody className="p-6 space-y-4">
        {!showAddForm && (
          <button
            type="button"
            onClick={openAddForm}
            className="w-full h-10 rounded-lg border border-dashed border-border text-muted-foreground hover:text-emerald-500 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all text-sm font-medium flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Cadastrar MAC
          </button>
        )}

        {showAddForm && (
          <div className="p-4 rounded-xl border border-border space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground/90">
                {editingId ? "Editar registro" : "Novo registro"}
              </h3>
              <button type="button" onClick={resetForm} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Cliente (opcional)</label>
              <ClientPickerLocal tenantId={tenantId} selected={pickedClient} onSelect={setPickedClient} onClear={() => setPickedClient(null)} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1 space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">MAC</label>
                <input
                  value={macInput}
                  onChange={(e) => setMacInput(e.target.value)}
                  disabled={!!editingId}
                  placeholder="AA:BB:CC:DD:EE:FF"
                  className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50 disabled:opacity-60"
                />
              </div>
              <div className="col-span-1 space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Status</label>
                <select
                  value={statusInput}
                  onChange={(e) => setStatusInput(e.target.value as "trial" | "paid")}
                  className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50"
                >
                  <option value="paid">Pago</option>
                  <option value="trial">Trial</option>
                </select>
              </div>
              <div className="col-span-1 space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Validade</label>
                <FormattedDateInput
                  type="date"
                  value={validUntilInput}
                  onChange={(e) => setValidUntilInput(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={resetForm} className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}

        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Cliente</th>
                  <th className="text-left px-3 py-2 font-medium">Usuário / Servidor</th>
                  <th className="text-left px-3 py-2 font-medium">MAC</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Validade</th>
                  <th className="text-left px-3 py-2 font-medium">Feito por</th>
                  <th className="text-left px-3 py-2 font-medium">Quando</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                      Carregando...
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                      Nenhum MAC registrado ainda.
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((row) => {
                    const serverMeta = Array.isArray(row.clients?.servers) ? row.clients?.servers[0] : row.clients?.servers;
                    const isExpired = new Date(`${row.valid_until}T23:59:59`).getTime() < Date.now();
                    return (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium text-foreground/90">
                          {row.clients?.display_name || <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.clients?.server_username || "—"}
                          {serverMeta?.name ? ` · ${serverMeta.name}` : ""}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-foreground/90">{row.mac}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${
                              row.status === "paid" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
                            }`}
                          >
                            {row.status === "paid" ? "Pago" : "Trial"}
                          </span>
                        </td>
                        <td className={`px-3 py-2 ${isExpired ? "text-rose-500 font-medium" : "text-foreground/90"}`}>
                          {String(row.valid_until).split("-").reverse().join("/")}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.activated_by || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(row.activated_at).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => openEditForm(row)} className="p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors" title="Editar">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(row)} className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors" title="Remover">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-colors">
          Fechar
        </button>
      </ModalFooter>

      {ConfirmUI}
      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </Modal>
  );
}

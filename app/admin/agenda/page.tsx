"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useSearchParams, useRouter } from "next/navigation";
import ToastNotifications, { ToastMessage } from "../ToastNotifications";

// --- TIPOS ---
type GoogleContact = {
  id: string;
  tenant_id: string;
  google_resource_name: string;
  display_name: string | null;
  email: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
  secondary_phone: string | null;
  linked_server_id: string | null;
  avatar_url: string | null;
  birthday: string | null;
  operadora: string | null;
  labels: string[] | null;
  synced_at: string;
};

type SortKey = "name" | "phone" | "operadora" | "labels" | "birthday";
type SortDir = "asc" | "desc";

// --- HELPERS ---
function formatBRPhoneFromDigits(digits: string | null, label?: string | null): string {
  if (!digits) return "";
  const clean = digits.replace(/\D/g, "");
  let ddd = "", rest = "";

  if (clean.startsWith("55") && clean.length >= 12) {
    ddd = clean.slice(2, 4);
    rest = clean.slice(4);
  } else if (clean.length >= 10 && clean.length <= 11) {
    ddd = clean.slice(0, 2);
    rest = clean.slice(2);
  } else {
    return digits; // Retorna original se não for padrão BR
  }

  let formatted = "";
  if (rest.length === 9) formatted = `(0${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  else if (rest.length === 8) formatted = `(0${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  else formatted = `(0${ddd}) ${rest}`;

  return label ? `${label}: ${formatted}` : formatted;
}

function compareText(a: string, b: string) {
  return (a || "").localeCompare((b || ""), "pt-BR", { sensitivity: "base" });
}

function formatBirthday(b: string | null) {
  if (!b) return "—";
  const parts = b.split("-");
  if (parts.length >= 3) {
    return `${parts[parts.length - 1]}/${parts[parts.length - 2]}`;
  }
  return b;
}

function AgendaPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [rows, setRows] = useState<GoogleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Filtros & Paginação
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState("Todos");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const uniqueLabels = useMemo(() => Array.from(new Set(rows.flatMap(r => r.labels || []))).sort(), [rows]);

  // ✅ Funções de Seleção
  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // ✅ Ação em Massa: Sincronizar Operadora
  async function handleMassSyncOperadora() {
    if (selectedIds.size === 0) return;
    addToast("warning", "Em desenvolvimento", `Sincronizando operadora para ${selectedIds.size} contatos (Requer API de consulta).`);
    // Aqui vai a futura lógica de integração com a API de portabilidade/operadora
    setSelectedIds(new Set());
  }

  // Modais e Ações
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  
  const [msgMenuForId, setMsgMenuForId] = useState<string | null>(null);
  const [showSendNow, setShowSendNow] = useState<{ open: boolean; contactId: string | null; phone: string | null }>({ open: false, contactId: null, phone: null });
  const [messageText, setMessageText] = useState("");
  const [sendingNow, setSendingNow] = useState(false);

  // ✅ Novos Modais: Edição e Exclusão
  const [editModal, setEditModal] = useState<{ open: boolean; contact: GoogleContact | null }>({ open: false, contact: null });
  const [editForm, setEditForm] = useState<Partial<GoogleContact>>({});
  const [isSaving, setIsSaving] = useState(false);

  const [deleteModal, setDeleteModal] = useState<{ open: boolean; contact: GoogleContact | null }>({ open: false, contact: null });
  const [deleteFromGoogle, setDeleteFromGoogle] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  const [sessionOptions, setSessionOptions] = useState<{id: string, label: string}[]>([{ id: "default", label: "Carregando..." }]);
  const [selectedSessionNow, setSelectedSessionNow] = useState("default");

  function addToast(type: "success" | "error" | "warning", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    if (toastTimersRef.current[id]) clearTimeout(toastTimersRef.current[id]);
    toastTimersRef.current[id] = setTimeout(() => removeToast(id), 5000);
  }

  function removeToast(id: number) {
    if (toastTimersRef.current[id]) {
      clearTimeout(toastTimersRef.current[id]);
      delete toastTimersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  useEffect(() => {
    const syncStatus = searchParams.get("sync");
    const syncCount = searchParams.get("count");
    if (syncStatus === "success") {
      addToast("success", "Sincronização concluída", `${syncCount} contatos importados do Google.`);
      router.replace("/admin/agenda");
    }
    loadData();
    loadWhatsAppSessions();
  }, [searchParams]);

  async function loadData() {
    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      setTenantId(tid);
      if (!tid) return;

      const { data: contactsData, error: contactsErr } = await supabaseBrowser
        .from("google_contacts")
        .select("*")
        .eq("tenant_id", tid);

      if (contactsErr) throw contactsErr;
      setRows(contactsData || []);
    } catch (e: any) {
      addToast("error", "Erro ao carregar", e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadWhatsAppSessions() {
    try {
      const res = await fetch("/api/whatsapp/status").then(r => r.json()).catch(() => ({}));
      if (res.connected) {
        setSessionOptions([{ id: "default", label: "Contato Principal (Conectado)" }]);
      } else {
        setSessionOptions([{ id: "default", label: "Contato Principal (Desconectado)" }]);
      }
    } catch {
      setSessionOptions([{ id: "default", label: "Sessão Padrão" }]);
    }
  }

  // --- ORDENAÇÃO & FILTROS ---
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return rows.filter((r) => {
      if (labelFilter !== "Todos" && (!r.labels || !r.labels.includes(labelFilter))) return false;
      if (q) {
        const hay = [r.display_name, r.phone_e164, r.email, r.operadora, ...(r.labels || [])]
          .join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, labelFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = compareText(a.display_name || "", b.display_name || ""); break;
        case "phone": cmp = compareText(a.phone_e164 || "", b.phone_e164 || ""); break;
        case "operadora": cmp = compareText(a.operadora || "", b.operadora || ""); break;
        case "birthday": cmp = compareText(a.birthday || "", b.birthday || ""); break;
        case "labels": cmp = compareText((a.labels || []).join(""), (b.labels || []).join("")); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function setAllVisible(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of visible) {
        if (checked) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const total = visible.length;
    const sel = visible.filter((r) => selectedIds.has(r.id)).length;
    el.indeterminate = sel > 0 && sel < total;
  }, [selectedIds, visible]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(nextKey); setSortDir("asc"); }
  }

  // --- AÇÕES ---
  const handleSendMessage = async () => {
    if (!tenantId || !showSendNow.contactId || !showSendNow.phone) return;
    const msg = messageText.trim();
    if (!msg) return addToast("error", "Mensagem vazia", "Digite algo.");

    setSendingNow(true);
    try {
      const res = await fetch("/api/whatsapp/envio_avulso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          phone_e164: showSendNow.phone,
          message: msg,
          whatsapp_session: selectedSessionNow,
        }),
      });

      if (!res.ok) throw new Error("Falha ao enviar");
      addToast("success", "Enviado", "Mensagem enviada com sucesso.");
      setShowSendNow({ open: false, contactId: null, phone: null });
      setMessageText("");
    } catch (e: any) {
      addToast("error", "Falha no envio", e.message);
    } finally {
      setSendingNow(false);
    }
  };

  async function handleSilentSync() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/google/sync-silent", { method: "POST" });
      const data = await res.json();
      
      if (res.ok) {
        addToast("success", "Sincronização concluída", `${data.count} contatos importados.`);
        loadData();
      } else {
        addToast("warning", "Acesso necessário", "Redirecionando para o Google...");
        window.location.href = "/api/auth/google";
      }
    } catch (err: any) {
      addToast("error", "Erro ao sincronizar", err.message);
    } finally {
      setLoading(false);
    }
  }

  // ✅ Função para Salvar Edição no Google
  async function handleSaveContact() {
    if (!editModal.contact) return;
    setIsSaving(true);
    try {
      // ESTA ROTA SERÁ CRIADA NO PRÓXIMO PASSO
      const res = await fetch("/api/auth/google/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editModal.contact, ...editForm })
      });
      
      if (!res.ok) throw new Error("Rota de atualização do Google ainda não implementada no backend.");
      
      addToast("success", "Salvo", "Contato atualizado no sistema e no celular.");
      setEditModal({ open: false, contact: null });
      loadData();
    } catch (err: any) {
      addToast("error", "Aviso de API", err.message);
    } finally {
      setIsSaving(false);
    }
  }

  // ✅ Função para Deletar Contato no Google
  async function handleDeleteContact() {
    if (!deleteModal.contact) return;
    setIsDeleting(true);
    try {
      // ESTA ROTA SERÁ CRIADA NO PRÓXIMO PASSO
      const res = await fetch("/api/auth/google/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          id: deleteModal.contact.id, 
          resourceName: deleteModal.contact.google_resource_name,
          deleteFromGoogle 
        })
      });
      
      if (!res.ok) throw new Error("Rota de exclusão do Google ainda não implementada no backend.");

      addToast("success", "Excluído", `Contato removido${deleteFromGoogle ? " do sistema e do Google" : " apenas do sistema"}.`);
      setDeleteModal({ open: false, contact: null });
      loadData();
    } catch (err: any) {
      addToast("error", "Aviso de API", err.message);
    } finally {
      setIsDeleting(false);
    }
  }

  function openEditModal(contact: GoogleContact) {
    setEditForm({
      display_name: contact.display_name,
      email: contact.email,
      phone_e164: contact.phone_e164,
      secondary_phone: contact.secondary_phone,
      labels: contact.labels || [],
    });
    setEditModal({ open: true, contact });
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors" onClick={() => setMsgMenuForId(null)}>
      
      {/* TOPO */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
            Agenda de Contatos
          </h1>
          <p className="text-xs text-slate-500 dark:text-white/50 mt-1">Gerencie os contatos sincronizados com o Google.</p>
        </div>
        
        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            onClick={handleSilentSync}
            disabled={loading}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-blue-900/20 transition-all disabled:opacity-50"
          >
            <IconSync /> {loading ? "Sincronizando..." : "Sincronizar Google"}
          </button>
        </div>
      </div>

      {/* FILTROS */}
      <div className="px-3 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm flex flex-col md:flex-row gap-2 mb-6 z-20">
        <div className="flex-1 relative w-full md:w-auto">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por nome ou telefone..."
            className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none"
          />
        </div>
        <select 
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
          className="h-10 px-3 w-full md:w-auto bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white"
        >
          <option value="Todos">Grupo (Todos)</option>
          {uniqueLabels.map((lbl) => (
            <option key={lbl} value={lbl}>{lbl}</option>
          ))}
        </select>
      </div>

      {/* ✅ BARRA DE AÇÃO EM MASSA ATUALIZADA */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-500/30 rounded-xl mb-4 animate-in slide-in-from-top-2 mx-3 sm:mx-0">
          <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
            {selectedIds.size} contato(s) selecionado(s)
          </span>
          <button 
            onClick={handleMassSyncOperadora}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-colors"
          >
            Sincronizar Operadora
          </button>
        </div>
      )}

      {/* TABELA */}
      {!loading && (
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0">
          <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-bold tracking-tight text-slate-800 dark:text-white whitespace-nowrap">
              Lista de Contatos
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold">
                {filtered.length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[250px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold uppercase text-slate-500 dark:text-white/55">
                  <Th width={40}>
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={visible.length > 0 && visible.every((r) => selectedIds.has(r.id))}
                      onChange={(e) => setAllVisible(e.target.checked)}
                      className="rounded border-slate-300 dark:border-white/20 bg-slate-100 dark:bg-white/5"
                    />
                  </Th>
                  <ThSort label="Contato" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                  {/* Colunas Mescladas */}
                  <ThSort label="Telefones e Emails" active={sortKey === "phone"} dir={sortDir} onClick={() => toggleSort("phone")} />
                  <Th align="center"><SortClick label="Grupo (Marcadores)" active={sortKey === "labels"} dir={sortDir} onClick={() => toggleSort("labels")} /></Th>
                  <Th align="center">Ações</Th>  
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
                {visible.map((r) => (
                  <tr 
                    key={r.id} 
                    className={`transition-colors group cursor-pointer ${
                      selectedIds.has(r.id) ? "bg-indigo-50/50 dark:bg-indigo-500/10" : "hover:bg-slate-50 dark:hover:bg-white/5"
                    }`}
                    onClick={() => toggleSelected(r.id, !selectedIds.has(r.id))}
                  >
                    <Td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={(e) => toggleSelected(r.id, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-slate-300 dark:border-white/20 bg-slate-100 dark:bg-white/5"
                      />
                    </Td>
                    
                    {/* ✅ FOTO 3x MAIOR (108px) E NOME */}
                    <Td>
                      <div className="flex items-center gap-4 py-2">
                        {r.avatar_url ? (
                          <img src={r.avatar_url} alt="Foto" className="w-[108px] h-[108px] rounded-full object-cover border-2 border-slate-200 dark:border-white/10 shadow-md shrink-0" />
                        ) : (
                          <div className="w-[108px] h-[108px] rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center font-bold text-slate-500 text-3xl shrink-0">
                            {r.display_name?.charAt(0) || "?"}
                          </div>
                        )}
                        <div>
                          <div className="font-bold text-lg text-slate-800 dark:text-white">
                            {r.display_name || "Sem Nome"}
                          </div>
                          {r.operadora && (
                            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase mt-1">
                              OP: {r.operadora}
                            </div>
                          )}
                        </div>
                      </div>
                    </Td>

                    {/* ✅ TELEFONES E EMAILS COMBINADOS */}
                    <Td>
                      <div className="flex flex-col gap-1.5 py-2">
                        {r.phone_e164 && (
                          <span className="font-mono font-medium text-slate-700 dark:text-white/90">
                            {formatBRPhoneFromDigits(r.phone_e164, "Celular")}
                          </span>
                        )}
                        {r.secondary_phone && (
                          <span className="font-mono font-medium text-slate-600 dark:text-white/70">
                            {formatBRPhoneFromDigits(r.secondary_phone, "Telefone")}
                          </span>
                        )}
                        {!r.phone_e164 && !r.secondary_phone && (
                          <span className="italic text-slate-400 text-xs">Sem telefone</span>
                        )}
                        
                        {r.email && (
                          <div className="text-xs text-sky-600 dark:text-sky-400 mt-1 flex items-center gap-1">
                            ✉️ {r.email}
                          </div>
                        )}
                      </div>
                    </Td>

                    <Td align="center">
                      <div className="flex flex-wrap gap-1 justify-center max-w-[200px] mx-auto">
                        {r.labels && r.labels.length > 0 ? r.labels.map(l => (
                          <span key={l} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/[0.08] text-slate-600 dark:text-white/75 border border-slate-200 dark:border-white/15">
                            {l}
                          </span>
                        )) : <span className="text-slate-300 dark:text-white/20 text-xs italic">—</span>}
                      </div>
                    </Td>

                    <Td align="right">
                      <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 relative">
                        
                        <div className="relative">
                          <IconActionBtn 
                            title="WhatsApp" 
                            tone="green" 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              if (!r.phone_e164) return addToast("warning", "Sem telefone", "Este contato não possui um número válido.");
                              setMsgMenuForId((cur) => (cur === r.id ? null : r.id)); 
                            }}
                          >
                            <IconChat />
                          </IconActionBtn>

                          {msgMenuForId === r.id && (
                            <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0f141a] z-50 shadow-2xl overflow-hidden">
                              <MenuItem
                                icon={<IconSend />}
                                label="Enviar agora"
                                onClick={() => {
                                  setMsgMenuForId(null);
                                  setMessageText("");
                                  setShowSendNow({ open: true, contactId: r.id, phone: r.phone_e164 });
                                }}
                              />
                            </div>
                          )}
                        </div>

                        <IconActionBtn title="Editar Contato" tone="amber" onClick={(e) => { e.stopPropagation(); openEditModal(r); }}>
                          <IconEdit />
                        </IconActionBtn>

                        <IconActionBtn title="Excluir" tone="red" onClick={(e) => { e.stopPropagation(); setDeleteModal({ open: true, contact: r }); }}>
                          <IconTrash />
                        </IconActionBtn>

                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="h-24 md:h-20" />
          </div>
        </div>
      )}

      {/* --- MODAIS REUTILIZADOS --- */}
      {showSendNow.open && (
         <Modal title="Enviar Mensagem Rápida" onClose={() => setShowSendNow({ open: false, contactId: null, phone: null })}>
           <div className="space-y-4">
             <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 p-3 rounded-lg flex items-center gap-3">
                <span className="text-xl">💬</span>
                <div className="text-sm text-emerald-900 dark:text-emerald-200">
                  Enviando para <strong>{formatBRPhoneFromDigits(showSendNow.phone!)}</strong>
                </div>
             </div>
             <div>
               <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Sessão de Envio</label>
               <select
                 value={selectedSessionNow}
                 onChange={(e) => setSelectedSessionNow(e.target.value)}
                 className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors text-sm font-medium"
               >
                 {sessionOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
               </select>
             </div>
             <textarea
               value={messageText}
               onChange={(e) => setMessageText(e.target.value)}
               className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl p-4 text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors min-h-[120px] text-sm resize-none"
               placeholder="Digite a sua mensagem aqui..."
               autoFocus
             />
             <div className="flex justify-end gap-3 pt-2">
               <button onClick={() => setShowSendNow({ open: false, contactId: null, phone: null })} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 text-sm font-bold">
                 Cancelar
               </button>
               <button onClick={handleSendMessage} disabled={sendingNow} className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-2 text-sm disabled:opacity-50">
                 <IconSend /> {sendingNow ? "Enviando..." : "Enviar Agora"}
               </button>
             </div>
           </div>
         </Modal>
       )}

      {/* ✅ MODAL DE EDIÇÃO */}
      {editModal.open && editModal.contact && (
        <Modal title="Editar Contato" onClose={() => setEditModal({ open: false, contact: null })}>
          <div className="space-y-4">
            
            <div className="flex justify-center mb-4">
               {editModal.contact.avatar_url ? (
                  <img src={editModal.contact.avatar_url} alt="Foto" className="w-24 h-24 rounded-full object-cover border-2 border-slate-200" />
               ) : (
                  <div className="w-24 h-24 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-500 text-2xl">
                    {editForm.display_name?.charAt(0) || "?"}
                  </div>
               )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">Nome Completo</label>
                <input value={editForm.display_name || ""} onChange={e => setEditForm({...editForm, display_name: e.target.value})} className="w-full p-2.5 border rounded-lg bg-slate-50 dark:bg-black/20 dark:border-white/10 outline-none focus:border-amber-500 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">E-mail</label>
                <input value={editForm.email || ""} onChange={e => setEditForm({...editForm, email: e.target.value})} className="w-full p-2.5 border rounded-lg bg-slate-50 dark:bg-black/20 dark:border-white/10 outline-none focus:border-amber-500 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Telefone (Celular)</label>
                <input value={editForm.phone_e164 || ""} onChange={e => setEditForm({...editForm, phone_e164: e.target.value})} className="w-full p-2.5 border rounded-lg bg-slate-50 dark:bg-black/20 dark:border-white/10 outline-none focus:border-amber-500 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Secundário (Telefone)</label>
                <input value={editForm.secondary_phone || ""} onChange={e => setEditForm({...editForm, secondary_phone: e.target.value})} className="w-full p-2.5 border rounded-lg bg-slate-50 dark:bg-black/20 dark:border-white/10 outline-none focus:border-amber-500 text-sm font-mono" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">Grupos / Marcadores (Google)</label>
                <input 
                  value={(editForm.labels || []).join(", ")} 
                  onChange={e => setEditForm({...editForm, labels: e.target.value.split(",").map(s => s.trim()).filter(s => s)})} 
                  className="w-full p-2.5 border rounded-lg bg-slate-50 dark:bg-black/20 dark:border-white/10 outline-none focus:border-amber-500 text-sm" 
                  placeholder="Ex: VIP, Fornecedores"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-white/10">
              <button onClick={() => setEditModal({ open: false, contact: null })} className="px-4 py-2 rounded-lg text-slate-500 text-sm font-bold">Cancelar</button>
              <button onClick={handleSaveContact} disabled={isSaving} className="px-6 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-bold flex items-center gap-2 text-sm disabled:opacity-50">
                {isSaving ? "Salvando..." : "Salvar no Google"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ✅ MODAL DE EXCLUSÃO */}
      {deleteModal.open && deleteModal.contact && (
        <Modal title="Excluir Contato" onClose={() => setDeleteModal({ open: false, contact: null })}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-white/70">
              Você está prestes a excluir o contato <strong>{deleteModal.contact.display_name}</strong>.
            </p>
            
            <label className="flex items-center gap-3 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg cursor-pointer">
              <input 
                type="checkbox" 
                checked={deleteFromGoogle} 
                onChange={e => setDeleteFromGoogle(e.target.checked)}
                className="w-5 h-5 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
              />
              <span className="text-sm font-bold text-rose-900 dark:text-rose-200">
                Excluir também da agenda do celular (Google Contacts)
              </span>
            </label>

            <div className="flex justify-end gap-3 pt-4">
              <button onClick={() => setDeleteModal({ open: false, contact: null })} className="px-4 py-2 rounded-lg text-slate-500 text-sm font-bold">Cancelar</button>
              <button onClick={handleDeleteContact} disabled={isDeleting} className="px-6 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-2 text-sm disabled:opacity-50">
                {isDeleting ? "Excluindo..." : "Confirmar Exclusão"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <div className="relative z-">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>

    </div>
  );
}

export default function AgendaPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400 animate-pulse">Carregando Agenda...</div>}>
      <AgendaPageContent />
    </Suspense>
  );
}

// --- COMPONENTES VISUAIS REAPROVEITADOS ---
const ALIGN_CLASS: Record<"left" | "right" | "center", string> = { left: "text-left", right: "text-right", center: "text-center" };
function Th({ children, width, align = "left" }: { children: React.ReactNode; width?: number; align?: "left" | "right" | "center" }) { return <th className={`px-3 py-2 ${ALIGN_CLASS[align]}`} style={{ width }}>{children}</th>; }
function ThSort({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) { return <th onClick={onClick} className="px-3 py-2 cursor-pointer select-none group hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors text-left"><div className="flex items-center gap-1">{label} <span className={`transition-opacity ${active ? "opacity-100 text-emerald-600" : "opacity-40 group-hover:opacity-70"}`}>{dir === "asc" ? <IconSortUp /> : <IconSortDown />}</span></div></th>; }
function SortClick({ label, onClick, active, dir }: { label: string; onClick: () => void; active: boolean; dir: SortDir }) { return <div onClick={onClick} className="inline-flex items-center justify-center gap-1 cursor-pointer select-none hover:text-emerald-500 transition-colors"><span className="font-bold uppercase text-xs tracking-wide">{label}</span><span className={`transition-opacity flex items-center ${active ? "opacity-100 text-emerald-600" : "opacity-30"}`}>{dir === "asc" ? <IconSortUp /> : <IconSortDown />}</span></div>; }
function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) { let alignClass = "text-left"; if (align === "right") alignClass = "text-right"; if (align === "center") alignClass = "text-center"; return <td className={`px-3 py-2 ${alignClass} align-middle`}>{children}</td>; }

function IconActionBtn({ children, title, tone, onClick, loading = false }: { children: React.ReactNode; title: string; tone: "blue" | "green" | "amber" | "purple" | "red"; onClick: (e: React.MouseEvent) => void; loading?: boolean; }) {
  const colors = {
    blue: "text-sky-500 bg-sky-50 border-sky-200 hover:bg-sky-100 dark:bg-sky-500/10 dark:border-sky-500/20",
    green: "text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20",
    amber: "text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20",
    purple: "text-purple-600 bg-purple-50 border-purple-200 hover:bg-purple-100",
    red: "text-rose-600 bg-rose-50 border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:border-rose-500/20",
  };
  return <button onClick={(e) => { e.stopPropagation(); if(!loading) onClick(e); }} title={title} className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}>{children}</button>;
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) { return <button onClick={onClick} className="group w-full px-4 py-2.5 flex items-center gap-3 text-slate-600 dark:text-white/60 hover:bg-emerald-500/10 hover:text-emerald-600 transition-all text-left text-sm font-bold tracking-tight rounded-lg"><span className="opacity-70 group-hover:scale-110 transition-transform">{icon}</span>{label}</button>; }
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { if (typeof document === "undefined") return null; return createPortal(<div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.60)", display: "grid", placeItems: "center", zIndex: 99999, padding: 16 }}><div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg bg-white dark:bg-[#0f141a] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden"><div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5"><div className="font-bold text-slate-800 dark:text-white">{title}</div><button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500"><IconX /></button></div><div className="p-4">{children}</div></div></div>, document.body); }

// --- ÍCONES ---
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconSortUp() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>; }
function IconSortDown() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>; }
function IconChat() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>; }
function IconSend() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></svg>; }
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>; }
function IconSync() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>; }

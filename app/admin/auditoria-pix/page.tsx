"use client";
// app/admin/auditoria-pix/page.tsx
// Lista PIX recebidos direto nas contas do Mercado Pago (PF/PJ) sem cobrança
// gerada pelo sistema — o admin identifica manualmente o cliente e conclui a
// renovação pelo mesmo fluxo/log que já existe hoje. Nenhuma renovação é
// disparada automaticamente aqui.
import { useEffect, useState } from "react";
import { Search, RefreshCw, CheckCircle2, X } from "lucide-react";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/app/admin/HookuseConfirm";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import RecargaCliente from "../cliente/recarga_cliente";

type PixRow = {
  id: string;
  origem_conta: "pf" | "pj";
  mp_payment_id: string;
  payer_name: string | null;
  payer_document: string | null;
  valor: number;
  data_hora: string;
  status: "novo" | "vinculado" | "concluido";
  whatsapp_username: string | null;
};

type ClienteOption = {
  id: string;
  display_name: string;
  whatsapp_username: string | null;
  server_name: string | null;
  username: string | null;
};

function fmtDoc(doc: string | null) {
  if (!doc) return "—";
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

function fmtBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtDataHora(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AuditoriaPixPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PixRow[]>([]);
  const [payerNames, setPayerNames] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const { confirm, ConfirmUI } = useConfirm();

  const [searchOpenId, setSearchOpenId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ClienteOption[]>([]);
  const [searching, setSearching] = useState(false);

  const [renewPickState, setRenewPickState] = useState<{ pixId: string; contas: ClienteOption[] } | null>(null);
  const [renewState, setRenewState] = useState<{ pixId: string; clientId: string; clientName: string } | null>(null);

  function addToast(type: "success" | "error" | "warning", title: string, message?: string) {
    const id = Date.now();
    setToasts((p) => [...p, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  async function loadData() {
    setLoading(true);
    const tid = await getCurrentTenantId();
    setTenantId(tid);
    if (!tid) {
      setLoading(false);
      return;
    }

    const [pixRes, cpfRes] = await Promise.all([
      supabaseBrowser
        .from("mp_pix_recebidos")
        .select("*")
        .eq("tenant_id", tid)
        .order("data_hora", { ascending: false }),
      supabaseBrowser
        .from("client_payer_cpfs")
        .select("whatsapp_username, payer_document")
        .eq("tenant_id", tid),
    ]);

    if (pixRes.error) {
      addToast("error", "Erro ao carregar PIX", pixRes.error.message);
      setLoading(false);
      return;
    }

    setRows((pixRes.data || []) as PixRow[]);

    const whatsList = Array.from(
      new Set((cpfRes.data || []).map((c: any) => c.whatsapp_username).filter(Boolean)),
    );
    if (whatsList.length > 0) {
      const { data: clientsData } = await supabaseBrowser
        .from("clients")
        .select("display_name, whatsapp_username, is_archived")
        .eq("tenant_id", tid)
        .in("whatsapp_username", whatsList);
      const nameMap: Record<string, string> = {};
      for (const c of clientsData || []) {
        if (!c.whatsapp_username) continue;
        if (!nameMap[c.whatsapp_username] || !c.is_archived) nameMap[c.whatsapp_username] = c.display_name;
      }
      setPayerNames(nameMap);
    } else {
      setPayerNames({});
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!searchOpenId || !tenantId) {
      setSearchResults([]);
      return;
    }
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser
        .from("clients")
        .select("id, display_name, whatsapp_username, server_username, servers(name)")
        .eq("tenant_id", tenantId)
        .eq("is_archived", false)
        .or(`display_name.ilike.%${q}%,whatsapp_username.ilike.%${q}%,server_username.ilike.%${q}%`)
        .limit(10);
      setSearchResults(
        (data || []).map((c: any) => ({
          id: c.id,
          display_name: c.display_name,
          whatsapp_username: c.whatsapp_username,
          server_name: c.servers?.name || null,
          username: c.server_username,
        })),
      );
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, searchOpenId, tenantId]);

  async function handleVincular(pix: PixRow, cliente: ClienteOption) {
    if (!tenantId || !pix.payer_document || !cliente.whatsapp_username) return;
    try {
      const { error: cpfErr } = await supabaseBrowser.from("client_payer_cpfs").upsert(
        {
          tenant_id: tenantId,
          whatsapp_username: cliente.whatsapp_username,
          payer_document: pix.payer_document,
          payer_name: pix.payer_name,
        },
        { onConflict: "tenant_id,payer_document" },
      );
      if (cpfErr) throw cpfErr;

      const { error: pixErr } = await supabaseBrowser
        .from("mp_pix_recebidos")
        .update({ status: "vinculado", whatsapp_username: cliente.whatsapp_username })
        .eq("id", pix.id)
        .eq("tenant_id", tenantId);
      if (pixErr) throw pixErr;

      addToast("success", "Vinculado", `CPF/CNPJ vinculado a ${cliente.display_name}. Da próxima vez, esse documento já aparece reconhecido.`);
      setSearchOpenId(null);
      setSearchQuery("");
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao vincular", e.message);
    }
  }

  async function handleAbrirRenovacao(pix: PixRow) {
    if (!tenantId || !pix.whatsapp_username) return;
    const { data: contas, error } = await supabaseBrowser
      .from("clients")
      .select("id, display_name, server_username, servers(name)")
      .eq("tenant_id", tenantId)
      .eq("whatsapp_username", pix.whatsapp_username)
      .eq("is_archived", false);

    if (error) {
      addToast("error", "Erro ao buscar contas", error.message);
      return;
    }

    const opcoes: ClienteOption[] = (contas || []).map((c: any) => ({
      id: c.id,
      display_name: c.display_name,
      whatsapp_username: pix.whatsapp_username,
      server_name: c.servers?.name || null,
      username: c.server_username,
    }));

    if (opcoes.length === 0) {
      addToast("warning", "Nenhuma conta ativa", "Esse WhatsApp não tem contas ativas pra renovar.");
      return;
    }
    if (opcoes.length === 1) {
      setRenewState({
        pixId: pix.id,
        clientId: opcoes[0].id,
        clientName: `${opcoes[0].display_name}${opcoes[0].server_name ? ` (${opcoes[0].server_name})` : ""}`,
      });
      return;
    }
    setRenewPickState({ pixId: pix.id, contas: opcoes });
  }

  async function handleRenovacaoConcluida(pixId: string) {
    if (!tenantId) return;
    await supabaseBrowser
      .from("mp_pix_recebidos")
      .update({ status: "concluido" })
      .eq("id", pixId)
      .eq("tenant_id", tenantId);
    setRenewState(null);
    addToast("success", "Renovação concluída", "Registrada no log normal, igual qualquer outra renovação manual.");
    loadData();
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-3 sm:px-6 min-h-screen bg-background transition-colors">
      <ToastNotifications toasts={toasts} removeToast={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
      {ConfirmUI}

      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
            Auditoria de PIX
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            PIX recebidos direto nas contas do Mercado Pago, sem cobrança gerada pelo sistema.
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground/90 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center text-muted-foreground animate-pulse py-10">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-muted-foreground py-10 px-4">
            Nenhum PIX recebido fora do fluxo normal ainda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Conta</th>
                  <th className="px-4 py-3 font-medium">Nome do pagador</th>
                  <th className="px-4 py-3 font-medium">CPF/CNPJ</th>
                  <th className="px-4 py-3 font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Data/Hora</th>
                  <th className="px-4 py-3 font-medium">Transação</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const nomeCliente = r.whatsapp_username ? payerNames[r.whatsapp_username] : null;
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wide ${
                            r.origem_conta === "pf"
                              ? "bg-sky-500/10 text-sky-500 border border-sky-500/20"
                              : "bg-violet-500/10 text-violet-500 border border-violet-500/20"
                          }`}
                        >
                          {r.origem_conta === "pf" ? "Pessoal" : "Empresarial"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground/90">{r.payer_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">{fmtDoc(r.payer_document)}</td>
                      <td className="px-4 py-3 font-medium text-emerald-500 tabular-nums">{fmtBRL(r.valor)}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDataHora(r.data_hora)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{r.mp_payment_id}</td>
                      <td className="px-4 py-3">
                        {r.status === "concluido" ? (
                          <span className="flex items-center gap-1 text-emerald-500 text-xs font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" /> {nomeCliente || "Concluído"}
                          </span>
                        ) : nomeCliente ? (
                          <span className="text-foreground/90 text-xs font-medium">{nomeCliente}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">Não identificado</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "concluido" ? (
                          <span className="text-[10px] text-muted-foreground uppercase">Concluído</span>
                        ) : r.status === "vinculado" ? (
                          <button
                            onClick={() => handleAbrirRenovacao(r)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                          >
                            Concluir Renovação
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setSearchOpenId(r.id);
                              setSearchQuery("");
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground/90 text-xs font-medium transition-colors ml-auto"
                          >
                            <Search className="w-3.5 h-3.5" /> Identificar cliente
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de busca de cliente pra vincular o CPF/CNPJ */}
      {searchOpenId && (
        <div
          className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSearchOpenId(null);
          }}
        >
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-medium text-foreground text-sm">Identificar cliente</h3>
              <button onClick={() => setSearchOpenId(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nome, WhatsApp ou usuário..."
                className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
              />
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {searching && <div className="text-xs text-muted-foreground py-2">Buscando...</div>}
                {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                  <div className="text-xs text-muted-foreground py-2">Nenhum cliente encontrado.</div>
                )}
                {searchResults.map((c) => {
                  const pix = rows.find((r) => r.id === searchOpenId);
                  return (
                    <button
                      key={c.id}
                      onClick={() => pix && handleVincular(pix, c)}
                      className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    >
                      <div className="text-sm font-medium text-foreground/90">{c.display_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.server_name ? `${c.server_name} · ` : ""}
                        {c.username || c.whatsapp_username}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Escolha de conta quando o WhatsApp tem mais de uma */}
      {renewPickState && (
        <div
          className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRenewPickState(null);
          }}
        >
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-medium text-foreground text-sm">Qual conta renovar?</h3>
              <button onClick={() => setRenewPickState(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-1.5">
              {renewPickState.contas.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setRenewState({
                      pixId: renewPickState.pixId,
                      clientId: c.id,
                      clientName: `${c.display_name}${c.server_name ? ` (${c.server_name})` : ""}`,
                    });
                    setRenewPickState(null);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                >
                  <div className="text-sm font-medium text-foreground/90">{c.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.server_name || "—"} · {c.username || "—"}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal de renovação — o mesmo usado no resto do sistema */}
      {renewState && (
        <RecargaCliente
          clientId={renewState.clientId}
          clientName={renewState.clientName}
          toastKey="auditoria_list_toasts"
          onClose={() => setRenewState(null)}
          onSuccess={async () => {
            await handleRenovacaoConcluida(renewState.pixId);
          }}
        />
      )}
    </div>
  );
}

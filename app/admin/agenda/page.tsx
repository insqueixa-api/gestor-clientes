"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useSearchParams, useRouter } from "next/navigation";

type GoogleContact = {
  id: string;
  google_resource_name: string;
  display_name: string | null;
  email: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
  avatar_url: string | null;
  birthday: string | null;
  operadora: string | null;
  labels: string[] | null;
  synced_at: string;
};

export default function AgendaPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncMessage, setSyncMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    // 1. Checar parâmetros da URL (Mensagens de Sucesso ou Erro da Sincronização)
    const syncStatus = searchParams.get("sync");
    const syncCount = searchParams.get("count");
    const errorStatus = searchParams.get("error");

    if (syncStatus === "success") {
      setSyncMessage({ type: "success", text: `Sincronização concluída! ${syncCount} contatos atualizados.` });
      // Limpa a URL após 5 segundos
      setTimeout(() => router.replace("/admin/agenda"), 5000);
    } else if (errorStatus) {
      setSyncMessage({ type: "error", text: "Falha ao sincronizar com o Google. Tente novamente." });
      setTimeout(() => router.replace("/admin/agenda"), 5000);
    }

    // 2. Carregar os contatos do banco
    loadContacts();
  }, [searchParams, router]);

  async function loadContacts() {
    setLoading(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("google_contacts")
        .select("*")
        .order("display_name", { ascending: true });

      if (error) throw error;
      setContacts(data || []);
    } catch (err) {
      console.error("Erro ao carregar contatos:", err);
    } finally {
      setLoading(false);
    }
  }

  // Formata a data de aniversário (ex: --11-07 para 07/11)
  function formatBirthday(b: string | null) {
    if (!b) return "-";
    const parts = b.split("-");
    if (parts.length >= 3) {
      return `${parts[parts.length - 1]}/${parts[parts.length - 2]}`;
    }
    return b;
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">Agenda de Contatos</h1>
          <p className="text-sm text-slate-500 dark:text-white/60 mt-1">
            Gerencie seus contatos do Google e integre com seus servidores IPTV.
          </p>
        </div>
        
        {/* BOTÃO DE SINCRONIZAÇÃO QUE CHAMA A API */}
        <a 
          href="/api/auth/google"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors shadow-lg shadow-blue-600/20 active:scale-95 text-sm"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
            <path d="M16 21v-5h5"/>
          </svg>
          Sincronizar Gmail
        </a>
      </div>

      {/* ALERTAS */}
      {syncMessage && (
        <div className={`p-4 rounded-xl border flex items-center gap-3 animate-in fade-in slide-in-from-top-2 ${
          syncMessage.type === "success" 
            ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400" 
            : "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400"
        }`}>
          <span className="text-xl">{syncMessage.type === "success" ? "✅" : "❌"}</span>
          <span className="font-bold text-sm">{syncMessage.text}</span>
        </div>
      )}

      {/* TABELA DE CONTATOS */}
      <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 dark:text-white/50 font-bold flex flex-col items-center">
            <svg className="animate-spin h-8 w-8 text-emerald-500 mb-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Carregando contatos...
          </div>
        ) : contacts.length === 0 ? (
          <div className="p-12 text-center text-slate-500 dark:text-white/50">
            <div className="text-4xl mb-3">📇</div>
            <p className="font-bold text-lg text-slate-700 dark:text-white">Nenhum contato encontrado</p>
            <p className="text-sm mt-1">Clique no botão "Sincronizar Gmail" para importar sua agenda.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
                  <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">Contato</th>
                  <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">Telefone</th>
                  <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">Marcadores (Labels)</th>
                  <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">Operadora</th>
                  <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">Aniversário</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {c.avatar_url ? (
                          <img src={c.avatar_url} alt={c.display_name || ""} className="w-10 h-10 rounded-full bg-slate-200 dark:bg-white/10 object-cover border border-slate-200 dark:border-white/10" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-slate-400 font-bold border border-slate-200 dark:border-white/10">
                            {c.display_name?.charAt(0)?.toUpperCase() || "?"}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-slate-800 dark:text-white truncate max-w-[200px]">
                            {c.display_name || "Sem Nome"}
                          </div>
                          {c.email && (
                            <div className="text-xs text-slate-500 dark:text-white/40 truncate max-w-[200px]">
                              {c.email}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    
                    <td className="px-5 py-4">
                      <div className="text-sm font-medium text-slate-700 dark:text-white/90">
                        {c.phone_e164 || c.phone_raw || <span className="text-slate-400 italic">Sem número</span>}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {c.labels && c.labels.length > 0 ? (
                          c.labels.map((label, i) => (
                            <span key={i} className="px-2 py-1 bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/70 text-[10px] font-bold rounded-md border border-slate-200 dark:border-white/10 whitespace-nowrap">
                              {label}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="px-2.5 py-1 bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/50 text-xs font-bold rounded-lg border border-slate-200 dark:border-white/10">
                        {c.operadora}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-sm font-medium text-slate-600 dark:text-white/70">
                      {formatBirthday(c.birthday)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
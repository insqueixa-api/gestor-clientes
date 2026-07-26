"use client";
// app/renew-beta/apps/[id]/AppDetailClient.tsx
//
// Página de detalhe de um aplicativo instalado — pedido do Marcio
// (25/07/2026): lugar único pra reunir tudo sobre um app específico
// (campos, ações, instruções de configuração curadas, e um aviso claro de
// que os aplicativos são de terceiros — o pagamento da licença deles é com
// o desenvolvedor, o admin só faz o intermédio da instalação/manutenção).
import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useConfirm } from "@/hooks/useConfirm";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { normalizeMacInput } from "@/lib/apps/field-types";

type AppField = { id: string; type: string; label: string; value: string };
type AppDetail = {
  id: string;
  app_id: string;
  name: string;
  icon_url: string | null;
  info_url: string | null;
  has_integration: boolean;
  can_check_validity: boolean;
  has_pending_setup_request: boolean;
  has_pending_removal_request: boolean;
  expiration: string | null;
  fields: AppField[];
  portal_setup_instructions: string | null;
  license_price: number | null;
  license_period: "annual" | "lifetime" | null;
};

function getStoredSession() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem("cp_session") || "";
  } catch {
    return "";
  }
}

export default function AppDetailClient() {
  const params = useParams();
  const sp = useSearchParams();
  const router = useRouter();
  const { confirm } = useConfirm();

  const clientAppId = String(params?.id || "");
  const clientId = sp.get("conta") || "";
  const [session, setSession] = useState<string | null>(null);

  useEffect(() => {
    setSession(getStoredSession());
  }, []);

  const [app, setApp] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(type: ToastMessage["type"], title: string, message?: string) {
    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), type, title, message }]);
  }
  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function loadDetail() {
    if (!session || !clientId || !clientAppId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/client-portal/apps/detail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: clientId, client_app_id: clientAppId }),
        cache: "no-store",
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Não foi possível carregar esse aplicativo.");
      setApp(result.data);
    } catch (err: any) {
      setError(err?.message || "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session === null) return;
    if (!session) {
      setError("Sessão inválida. Abra o link novamente.");
      setLoading(false);
      return;
    }
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, clientId, clientAppId]);

  function startEditing() {
    if (!app) return;
    const vals: Record<string, string> = {};
    for (const f of app.fields) vals[f.id] = f.value;
    setEditingValues(vals);
    setIsEditing(true);
  }

  async function handleSaveFields() {
    if (!session || !clientId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/client-portal/apps/update-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: clientId, client_app_id: clientAppId, fields: editingValues }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Não foi possível salvar.");
      addToast("success", "Salvo!", "Campos atualizados.");
      setIsEditing(false);
      await loadDetail();
    } catch (err: any) {
      addToast("error", "Não foi possível salvar", err?.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfigure() {
    if (!session || !clientId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/client-portal/apps/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: clientId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao configurar.");
      addToast("success", "Configurado!", result.expireDate ? `Vencimento: ${String(result.expireDate).split("-").reverse().join("/")}` : undefined);
      await loadDetail();
    } catch (err: any) {
      addToast("error", "Falha ao configurar", err?.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestSetup() {
    if (!session || !clientId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/client-portal/apps/request-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: clientId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao solicitar.");
      addToast("success", result.data?.already_pending ? "Já solicitado" : "Solicitado!", "Nosso suporte vai configurar esse aplicativo pra você em breve.");
      await loadDetail();
    } catch (err: any) {
      addToast("error", "Falha ao solicitar", err?.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckValidity() {
    if (!session || !clientId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/client-portal/apps/check-validity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: clientId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao verificar.");
      addToast("success", "Validade verificada!", result.expireDate ? `Vencimento: ${String(result.expireDate).split("-").reverse().join("/")}` : "Não encontrado no painel.");
      await loadDetail();
    } catch (err: any) {
      addToast("error", "Falha ao verificar", err?.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!session || !clientId || !app) return;
    const ok = await confirm({
      title: "Excluir aplicativo?",
      subtitle: `"${app.name}" será removido dessa conta. Se tiver configuração automática, também some do painel do parceiro; se não tiver, seu pedido vai pro nosso suporte concluir.`,
      tone: "rose",
      confirmText: "Excluir",
      cancelText: "Cancelar",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch("/api/client-portal/apps/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: clientId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao excluir.");
      if (result.data?.pending_admin) {
        addToast("success", result.data?.already_requested ? "Já solicitado" : "Exclusão solicitada", "Nosso suporte vai remover esse aplicativo em breve.");
        await loadDetail();
      } else {
        addToast("success", "Excluído!", `"${app.name}" foi removido dessa conta.`);
        setTimeout(() => router.push(`/renew-beta?conta=${clientId}`), 900);
      }
    } catch (err: any) {
      addToast("error", "Falha ao excluir", err?.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <ToastNotifications toasts={toasts} removeToast={removeToast} />

      <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-2">
          <button
            onClick={() => router.push(`/renew-beta?conta=${clientId}`)}
            className="w-8 h-8 flex items-center justify-center bg-card/10 hover:bg-card/20 rounded-lg text-white transition-colors shrink-0"
            title="Voltar"
          >
            <span className="text-lg leading-none mt-[-2px]">←</span>
          </button>
          <div className="text-xs font-bold text-white uppercase tracking-tight">Detalhes do aplicativo</div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4">
        {loading && <div className="text-center py-12 text-muted-foreground animate-pulse">Carregando...</div>}

        {!loading && error && (
          <div className="text-center py-12 text-rose-500 bg-rose-500/10 rounded-xl border border-dashed border-rose-500/30">{error}</div>
        )}

        {!loading && !error && app && (
          <>
            <div className="bg-card rounded-xl p-4 border border-border shadow-sm space-y-3">
              <div className="flex items-center gap-3">
                {app.icon_url ? (
                  <img src={app.icon_url} alt={app.name} className="w-14 h-14 rounded-xl object-cover border border-border shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center text-2xl shrink-0">📱</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-bold text-foreground truncate">
                    {app.name}
                    {app.fields.find((f) => f.type === "obs")?.value
                      ? ` (${app.fields.find((f) => f.type === "obs")?.value})`
                      : ""}
                  </p>
                </div>
                <button
                  onClick={startEditing}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-muted text-foreground border border-border text-xs font-bold hover:bg-muted/70 transition-colors"
                >
                  Editar
                </button>
              </div>
              {app.expiration && (
                <div className="flex items-center gap-1.5 -mt-2">
                  <p className="text-xs text-muted-foreground">
                    Validade do aplicativo: {String(app.expiration).split("T")[0].split("-").reverse().join("/")}
                  </p>
                  {app.can_check_validity && (
                    <button
                      disabled={busy}
                      onClick={handleCheckValidity}
                      className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[9px] font-bold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                    >
                      {busy ? "..." : "Atualizar"}
                    </button>
                  )}
                </div>
              )}

              {isEditing ? (
                <div className="space-y-2">
                  {app.fields.map((f) => (
                    <div key={f.id}>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{f.label}</label>
                      <input
                        type="text"
                        value={editingValues[f.id] ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const next = f.type === "mac" ? normalizeMacInput(raw) : raw;
                          setEditingValues((prev) => ({ ...prev, [f.id]: next }));
                        }}
                        placeholder={f.type === "obs" ? "Ex: Sala, Quarto, Escritório, Celular..." : undefined}
                        autoCapitalize={f.type === "mac" ? "characters" : "none"}
                        spellCheck={false}
                        className="w-full h-9 px-3 bg-muted border border-border rounded-lg text-sm text-foreground outline-none focus:border-sky-500"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button
                      disabled={busy}
                      onClick={handleSaveFields}
                      className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {busy ? "Salvando..." : "Salvar"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setIsEditing(false)}
                      className="flex-1 h-9 rounded-lg bg-muted text-foreground border border-border text-xs font-bold"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                      {app.fields.filter((f) => f.type !== "obs").map((f) => (
                        <span key={f.id} className="flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground border border-border text-[10px] font-mono rounded">
                          {f.label}: {f.value || "—"}
                          {f.value && (
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(f.value);
                                addToast("success", "Copiado!", `${f.label} copiado.`);
                              }}
                              className="text-muted-foreground hover:text-sky-500 transition-colors"
                              title="Copiar"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                              </svg>
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                    {app.has_pending_removal_request ? (
                      <span className="shrink-0 px-2 py-1 rounded-lg bg-muted text-muted-foreground border border-border text-[10px] font-bold">
                        Exclusão solicitada
                      </span>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={handleDelete}
                        className="shrink-0 px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] font-bold uppercase hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                      >
                        Excluir Aplicativo
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {app.has_integration && (
                      <button
                        disabled={busy}
                        onClick={handleConfigure}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-500 border border-sky-500/20 text-xs font-bold hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                      >
                        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {busy ? "Configurando..." : app.expiration ? "Reconfigurar aplicativo" : "Configurar aplicativo"}
                      </button>
                    )}
                    {!app.has_integration &&
                      (app.has_pending_setup_request ? (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground border border-border text-xs font-bold">
                          ✓ Configuração solicitada
                        </span>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={handleRequestSetup}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs font-bold hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                        >
                          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          {busy ? "Solicitando..." : "Solicitar configuração"}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>

            {app.portal_setup_instructions && (
              <div className="bg-card rounded-xl p-4 border border-border shadow-sm space-y-2">
                <p className="text-sm font-bold text-foreground">Como configurar</p>
                <p className="text-xs text-muted-foreground whitespace-pre-line">{app.portal_setup_instructions}</p>
              </div>
            )}

            <div className="bg-muted/40 rounded-xl p-4 border border-dashed border-border space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Esse aplicativo é de um desenvolvedor independente — não é nosso. A gente cuida da instalação e manutenção pra você, mas a licença/assinatura do app em si é paga direto ao desenvolvedor dele; nós somos só o intermédio.
              </p>
              {app.info_url && (
                <a
                  href={app.info_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs font-bold text-sky-500 hover:underline"
                >
                  Site oficial do aplicativo →
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

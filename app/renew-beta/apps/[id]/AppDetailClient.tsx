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

type AppPayment = {
  payment_id: string;
  pix_qr_code?: string;
  pix_qr_code_base64?: string;
  price_amount: number;
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

  // ✅ Pagamento avulso de licença (não mexe na assinatura IPTV)
  const [renewPayment, setRenewPayment] = useState<AppPayment | null>(null);
  const [renewPaymentBusy, setRenewPaymentBusy] = useState(false);
  const [renewPaymentDone, setRenewPaymentDone] = useState(false);
  const [renewPollInterval, setRenewPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (renewPollInterval) clearInterval(renewPollInterval);
    };
  }, [renewPollInterval]);

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

  function startPollingAppPayment(paymentId: string) {
    if (!session) return;
    if (renewPollInterval) clearInterval(renewPollInterval);
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/client-portal/payment-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: session, payment_id: paymentId }),
          cache: "no-store",
        });
        const result = await res.json().catch(() => null);
        if (!result?.ok) return; // erro de rede momentâneo — tenta de novo no próximo tick
        if (String(result.phase || "").toLowerCase() === "done") {
          clearInterval(interval);
          setRenewPollInterval(null);
          setRenewPaymentDone(true);
        }
      } catch {
        // continua tentando
      }
    }, 3000);
    setRenewPollInterval(interval);
  }

  async function handleRenewPayment() {
    if (!session || !clientId || !app) return;
    setRenewPaymentBusy(true);
    try {
      const res = await fetch("/api/client-portal/apps/renew-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: clientId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao gerar pagamento.");
      setRenewPaymentDone(false);
      setRenewPayment({
        payment_id: result.payment_id,
        pix_qr_code: result.pix_qr_code,
        pix_qr_code_base64: result.pix_qr_code_base64,
        price_amount: result.price_amount,
      });
      startPollingAppPayment(result.payment_id);
    } catch (err: any) {
      addToast("error", "Falha ao gerar pagamento", err?.message);
    } finally {
      setRenewPaymentBusy(false);
    }
  }

  function closeRenewPaymentModal() {
    if (renewPollInterval) clearInterval(renewPollInterval);
    setRenewPollInterval(null);
    setRenewPayment(null);
    setRenewPaymentDone(false);
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
                  <p className="text-lg font-bold text-foreground truncate">{app.name}</p>
                  {app.expiration && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Vencimento do aplicativo: {String(app.expiration).split("T")[0].split("-").reverse().join("/")}
                    </p>
                  )}
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
                        placeholder={f.type === "obs" ? "Ex: Sala, Quarto, Escritório..." : undefined}
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
                  {app.fields.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {app.fields.map((f) => (
                        <span key={f.id} className="px-2 py-0.5 bg-muted text-muted-foreground border border-border text-[10px] font-mono rounded">
                          {f.label}: {f.value || "—"}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={startEditing}
                      className="px-3 py-1.5 rounded-lg bg-muted text-foreground border border-border text-xs font-bold hover:bg-muted/70 transition-colors"
                    >
                      Editar
                    </button>
                    {app.has_integration && (
                      <button
                        disabled={busy}
                        onClick={handleConfigure}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-500 border border-sky-500/20 text-xs font-bold hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                      >
                        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {busy ? "Configurando..." : "Configurar aplicativo"}
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
                    {app.can_check_validity && (
                      <button
                        disabled={busy}
                        onClick={handleCheckValidity}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-xs font-bold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {busy ? "Verificando..." : "Verificar validade"}
                      </button>
                    )}
                    {app.license_price != null && (
                      <button
                        disabled={renewPaymentBusy}
                        onClick={handleRenewPayment}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors disabled:opacity-50"
                      >
                        {renewPaymentBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {renewPaymentBusy
                          ? "Gerando pagamento..."
                          : `Renovar aplicativo — ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(app.license_price)}${app.license_period === "annual" ? "/ano" : ""}`}
                      </button>
                    )}
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

      {/* Modal de pagamento avulso da licença — nunca mexe na assinatura */}
      {renewPayment && (
        <div
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && renewPaymentDone) closeRenewPaymentModal();
          }}
        >
          <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
            {renewPaymentDone ? (
              <>
                <div className="flex flex-col items-center gap-2 text-center py-4">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center text-3xl">✅</div>
                  <p className="text-base font-bold text-foreground">Pagamento confirmado!</p>
                  <p className="text-xs text-muted-foreground">
                    {app?.has_integration
                      ? 'O pagamento da licença foi registrado. Agora clique em "Configurar aplicativo" pra ativar de verdade.'
                      : 'O pagamento da licença foi registrado. Nosso suporte vai finalizar a ativação em breve.'}
                  </p>
                </div>
                <button
                  onClick={closeRenewPaymentModal}
                  className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
                >
                  Fechar
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-foreground">Renovar licença — {app?.name}</p>
                  <button onClick={closeRenewPaymentModal} className="text-muted-foreground hover:text-foreground text-xs">
                    ✕
                  </button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(renewPayment.price_amount)} — escaneie o QR Code ou copie o código PIX
                </p>
                {renewPayment.pix_qr_code_base64 && (
                  <img
                    src={`data:image/png;base64,${renewPayment.pix_qr_code_base64}`}
                    alt="QR Code PIX"
                    className="w-48 h-48 mx-auto rounded-lg border border-border"
                  />
                )}
                {renewPayment.pix_qr_code && (
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(renewPayment.pix_qr_code || "");
                      addToast("success", "Copiado!", "Código PIX copiado.");
                    }}
                    className="w-full h-10 rounded-lg bg-muted border border-border text-xs font-bold text-foreground hover:bg-muted/70 transition-colors"
                  >
                    Copiar código PIX
                  </button>
                )}
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Aguardando pagamento...
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

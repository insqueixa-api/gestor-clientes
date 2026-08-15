"use client";
// components/guia-tv/ModalCatalogo.tsx
// Extraído de GuiaTVView.tsx (14/08/2026) — só o admin abre esse modal
// ("Sincronizar Catálogo", atrás do botão "Sincronizar" que já é
// `!modoCliente`-gated), mas antes ficava embutido no mesmo arquivo do
// cliente final, então ~570 linhas de código admin-only iam pro bundle de
// todo mundo que abre /renew/guia-tv. Agora só carrega via next/dynamic
// quando showCatalogo vira true.
import React, { useEffect, useState } from "react";
import { RefreshCw, Database, CheckCircle, AlertTriangle, X } from "lucide-react";
import ToastNotifications from "@/hooks/ToastNotifications";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";

type SrvId = "elite" | "natv" | "fast";
type SrvStatus = "idle" | "running" | "ok" | "error";
type CatalogInfo = {
  ultimo_sync: string | null;
  filmes: number;
  series_unicas: number;
  episodios: number;
};

function formatDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function LimparCatalogo() {
  const [limpando, setLimpando] = React.useState(false);
  const [preview, setPreview] = React.useState<Record<string, number> | null>(
    null,
  );
  const [limpezaOk, setLimpezaOk] = React.useState<Record<
    string,
    number
  > | null>(null);
  const [srvLimpar, setSrvLimpar] = React.useState<string>("TODOS");
  const [showLimpar, setShowLimpar] = React.useState(false);

  // Lógica original preservada
  async function carregarPreview() {
    setShowLimpar(true);
    setPreview(null);
    setLimpezaOk(null);
    const d = await fetch("/api/catalogo/limpar")
      .then((r) => r.json())
      .catch(() => null);
    if (d?.ok) setPreview(d.preview);
  }

  // Lógica original preservada
  async function executarLimpeza() {
    setLimpando(true);
    setShowLimpar(false);
    const d = await fetch("/api/catalogo/limpar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servidor: srvLimpar }),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (d?.ok) {
      const res = { ...(d.resultado || {}) };
      if (d.orfaos_removidos) res["Órfãos"] = d.orfaos_removidos;
      setLimpezaOk(res);
    }
    setLimpando(false);
    setShowLimpar(false);
  }

  return (
    <div
      className={`p-5 rounded-xl border transition-colors ${limpezaOk ? "border-emerald-500/30 bg-emerald-500/[0.01]" : "border-border bg-card"}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div
              className={`w-2.5 h-2.5 rounded-full ${limpezaOk ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`}
            />

            <span className="text-sm font-semibold text-foreground tracking-tight">
              Limpar Títulos Removidos
            </span>
          </div>
          <div className="text-xs text-muted-foreground/90 mt-1.5 pl-5.5 leading-relaxed">
            Remove títulos que saíram dos servidores originais desde a última
            sincronização.
          </div>
          {limpezaOk && (
            <div className="text-xs text-emerald-500 font-medium mt-2 pl-5.5 flex items-center gap-1.5">
              <CheckCircle size={12} />✓{" "}
              {Object.entries(limpezaOk)
                .map(([s, n]) => `${s}: ${n} removidos`)
                .join(" · ")}
            </div>
          )}
        </div>
        <button
          onClick={
            limpando
              ? undefined
              : showLimpar
                ? () => setShowLimpar(false)
                : carregarPreview
          }
          disabled={limpando}
          className={`shrink-0 h-9 w-32 justify-center rounded-lg font-bold text-xs flex items-center gap-2 transition-all ${limpando ? "bg-rose-600 text-white shadow-lg shadow-rose-900/20" : showLimpar ? "bg-muted hover:bg-muted/80 text-foreground" : "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20"}`}
        >
          <RefreshCw
            size={12}
            className={limpando ? "animate-spin" : "hidden"}
          />
          {!limpando && (showLimpar ? <X size={13} /> : <X size={13} />)}
          {limpando ? "Limpando..." : showLimpar ? "Cancelar" : "Limpar Agora"}
        </button>
      </div>
      {showLimpar && (
        <div className="mt-5 p-4 rounded-xl bg-muted/40 border border-border animate-in slide-in-from-top-2">
          <div className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3">
            Selecione o servidor alvo:
          </div>
          <div className="flex flex-wrap gap-2 mb-4 bg-muted/60 p-1.5 rounded-lg border border-border/60">
            {["TODOS", "ELITE", "NATV", "FAST"].map((s) => (
              <button
                key={s}
                onClick={() => setSrvLimpar(s)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${srvLimpar === s ? "bg-rose-600 text-white shadow" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"}`}
              >
                {s}
              </button>
            ))}
          </div>
          {preview ? (
            <div className="text-sm text-foreground/90 mb-5 bg-card/60 p-3.5 rounded-lg border border-border/80">
              <Database size={13} className="inline-block mr-2 text-rose-400" />
              {srvLimpar === "TODOS"
                ? Object.entries(preview)
                    .map(([s, n]) => `${s}: ${n} títulos`)
                    .join(" · ")
                : `${srvLimpar}: ${preview[srvLimpar] || 0} títulos serão removidos.`}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic mb-5 p-3.5 flex items-center gap-2.5">
              <RefreshCw
                size={14}
                className="animate-spin text-muted-foreground/60"
              />
              Carregando preview...
            </div>
          )}
          <button
            onClick={executarLimpeza}
            className={`h-9 px-5 rounded-lg font-bold text-xs flex items-center gap-2 transition-all bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20`}
          >
            <RefreshCw size={12} />
            Confirmar Limpeza
          </button>
        </div>
      )}
    </div>
  );
}

// ✅ Refatorado visivelmente para Tailwind e temas claro/escuro
export default function ModalCatalogo({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Record<SrvId, SrvStatus>>({
    elite: "idle",
    natv: "idle",
    fast: "idle",
  });
  const [info, setInfo] = useState<Record<SrvId, CatalogInfo | null>>({
    elite: null,
    natv: null,
    fast: null,
  });
  const [serverMessages, setServerMessages] = useState<
    Record<SrvId, { text: string; type: "success" | "error" } | null>
  >({ elite: null, natv: null, fast: null });
  const [toasts, setToasts] = useState<any[]>([]);

  const removeToast = (id: number) =>
    setToasts((p) => p.filter((t) => t.id !== id));
  const addToast = (
    type: "success" | "error" | "warning",
    title: string,
    message: string,
  ) =>
    setToasts((p) => [
      ...p,
      { id: Date.now(), type, title, message, durationMs: 5000 },
    ]);

  // Lógica original preservada
  const carregarInfo = async () => {
    (["elite", "natv", "fast"] as SrvId[]).forEach(async (srv) => {
      try {
        const d = await fetch(`/api/epg/sync-catalog/${srv}`, {
          cache: "no-store",
        }).then((r) => r.json());
        if (d.resultado) {
          setInfo((p) => ({
            ...p,
            [srv]: {
              ultimo_sync: d.executado_em || null,
              filmes: d.resultado.filmes || 0,
              series_unicas:
                d.resultado.series_unicas || d.resultado.series || 0,
              episodios: d.resultado.episodios || 0,
            },
          }));
        }
      } catch {}
    });
  };

  useEffect(() => {
    carregarInfo();
  }, []);

  async function syncElite() {
    setStatus((p) => ({ ...p, elite: "running" }));
    setServerMessages((p) => ({ ...p, elite: null }));
    try {
      const d = await fetch("/api/epg/sync-catalog/elite", {
        method: "POST",
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      await carregarInfo();
      setStatus((p) => ({ ...p, elite: "ok" }));
      const msg = `Novos títulos: ${d.novos_titulos ?? 0} · Concluído em ${d.duracao_s}s`;
      setServerMessages((p) => ({
        ...p,
        elite: { text: msg, type: "success" },
      }));
      addToast("success", "EliteTV sincronizado", msg);
    } catch (e: any) {
      setStatus((p) => ({ ...p, elite: "error" }));
      setServerMessages((p) => ({
        ...p,
        elite: { text: e.message || "Erro desconhecido", type: "error" },
      }));
      addToast("error", "Falha ao sincronizar EliteTV", e.message);
    }
  }

  async function syncNaTV() {
    setStatus((p) => ({ ...p, natv: "running" }));
    setServerMessages((p) => ({ ...p, natv: null }));
    try {
      const d = await fetch("/api/epg/sync-catalog/natv", {
        method: "POST",
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      await carregarInfo();
      setStatus((p) => ({ ...p, natv: "ok" }));
      const msg = `Novos títulos: ${d.novos_titulos ?? 0} · Concluído em ${d.duracao_s}s`;
      setServerMessages((p) => ({
        ...p,
        natv: { text: msg, type: "success" },
      }));
      addToast("success", "NaTV sincronizado", msg);
    } catch (e: any) {
      setStatus((p) => ({ ...p, natv: "error" }));
      setServerMessages((p) => ({
        ...p,
        natv: { text: e.message || "Erro desconhecido", type: "error" },
      }));
      addToast("error", "Falha ao sincronizar NaTV", e.message);
    }
  }

  // ✅ Igual Elite/NaTV: uma chamada só. A Vercel busca o M3U através de um
  // relay na VM (IP dela não é bloqueado, o da Vercel é) — mas do ponto de
  // vista daqui é uma sync normal, sem etapa extra nem proxy.
  async function syncFast() {
    setStatus((p) => ({ ...p, fast: "running" }));
    setServerMessages((p) => ({ ...p, fast: null }));
    try {
      const d = await fetch("/api/epg/sync-catalog/fast", {
        method: "POST",
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      await carregarInfo();
      setStatus((p) => ({ ...p, fast: "ok" }));
      const msg = `Novos títulos: ${d.novos_titulos ?? 0} · Concluído em ${d.duracao_s}s`;
      setServerMessages((p) => ({
        ...p,
        fast: { text: msg, type: "success" },
      }));
      addToast("success", "FastTV sincronizado", msg);
    } catch (e: any) {
      setStatus((p) => ({ ...p, fast: "error" }));
      setServerMessages((p) => ({
        ...p,
        fast: { text: e.message || "Erro desconhecido", type: "error" },
      }));
      addToast("error", "Falha ao sincronizar FastTV", e.message);
    }
  }

  const SERVIDORES: {
    id: SrvId;
    label: string;
    cor: string;
    bgClass: string;
    onSync: () => void;
  }[] = [
    {
      id: "elite",
      label: "EliteTV",
      cor: "#6366f1",
      bgClass: "bg-indigo-600 hover:bg-indigo-500",
      onSync: syncElite,
    },
    {
      id: "natv",
      label: "NaTV",
      cor: "#10b981",
      bgClass: "bg-emerald-600 hover:bg-emerald-500",
      onSync: syncNaTV,
    },
    {
      id: "fast",
      label: "FastTV",
      cor: "#06b6d4",
      bgClass: "bg-sky-600 hover:bg-sky-500",
      onSync: syncFast,
    },
  ];
  const [tmdbStatus, setTmdbStatus] = useState<
    "idle" | "running" | "ok" | "error"
  >("idle");
  const [tmdbMessage, setTmdbMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [tmdbInfo, setTmdbInfo] = useState<{
    filmes: { sem_tmdb: number; com_tmdb: number };
    series: { sem_tmdb: number; com_tmdb: number };
  } | null>(null);
  const [tmdbConfirm, setTmdbConfirm] = useState(false);

  useEffect(() => {
    fetch("/api/epg/sync-tmdb")
      .then((r) => r.json())
      .then((d) => {
        if (d.filmes) setTmdbInfo(d);
      })
      .catch(() => {});
  }, []);

  async function syncTmdb() {
    setTmdbStatus("running");
    setTmdbConfirm(false);
    setTmdbMessage(null);
    let totalProc = 0,
      totalEnc = 0,
      totalNao = 0,
      lotes = 0;

    try {
      while (true) {
        // Removemos tipo e lote da URL. O backend vai fazer 50 por vez automaticamente pegando o que faltar (filme ou série).
        const d = await fetch(`/api/epg/sync-tmdb`, { method: "POST" }).then(
          (r) => r.json(),
        );
        if (d.error) throw new Error(d.error);

        if (d.processados === 0) {
          if (totalProc === 0) {
            const msg = "Todos os títulos já foram processados.";
            setTmdbMessage({ text: msg, type: "success" });
            addToast("success", "Enriquecimento TMDB", msg);
          }
          break;
        }

        totalProc += d.processados;
        totalEnc += d.encontrados;
        totalNao += d.nao_encontrados;
        lotes++;

        // Atualização em tempo real na tela
        setTmdbMessage({
          text: `Lote: ${lotes} | ${totalProc} consultados | ${totalEnc} encontrados`,
          type: "success",
        });

        if (!d.proximo_lote) break;

        // Atualiza a estatística global a cada lote
        const s = await fetch("/api/epg/sync-tmdb").then((r) => r.json());
        if (s.filmes) setTmdbInfo(s);

        // Delay de 2 segundos para não tomar block da API do TMDB
        await new Promise((r) => setTimeout(r, 2000));
      }

      const s = await fetch("/api/epg/sync-tmdb").then((r) => r.json());
      if (s.filmes) setTmdbInfo(s);

      setTmdbStatus("ok");
      if (totalProc > 0) {
        const msg = `Finalizado! ${totalProc} processados · ${totalEnc} encontrados · ${totalNao} não encontrados`;
        setTmdbMessage({ text: msg, type: "success" });
        addToast("success", "Enriquecimento TMDB concluído", msg);
      }
    } catch (e: any) {
      setTmdbStatus("error");
      setTmdbMessage({ text: e.message || "Erro desconhecido", type: "error" });
      addToast("error", "Falha no enriquecimento TMDB", e.message);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <ModalHeader onClose={onClose}>
        <div className="text-lg font-bold text-foreground flex items-center gap-2.5">
          <Database size={18} className="text-indigo-500" /> Sincronizar
          Catálogo (VOD)
        </div>
        <div className="text-xs text-muted-foreground/90 mt-1.5 leading-relaxed">
          Importa filmes e séries novos — rode cada servidor
          individualmente.
        </div>
      </ModalHeader>

        <ModalBody className="p-5 space-y-3.5 bg-muted/20">
          {SERVIDORES.map(({ id, label, cor, bgClass, onSync }) => {
            const st = status[id];
            const inf = info[id];
            const running = st === "running";
            const borderCol =
              st === "ok"
                ? cor + "40"
                : st === "error"
                  ? "#ef444430"
                  : running
                    ? cor + "30"
                    : "#2a2a2a30";
            const msgObj = serverMessages[id];

            return (
              <div
                key={id}
                className={`p-5 rounded-xl border transition-all ${st === "ok" ? "bg-card" : st === "running" ? "bg-card shadow-lg shadow-indigo-900/10" : "bg-card"}`}
                style={{ borderColor: borderCol }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${st === "ok" ? "" : st === "error" ? "bg-rose-500" : running ? "animate-pulse" : "bg-muted"}`}
                        style={{
                          backgroundColor: st === "error" ? undefined : cor,
                        }}
                      />
                      <span className="text-sm font-semibold text-foreground tracking-tight">
                        {label}
                      </span>
                    </div>
                    {inf && (
                      <div className="text-xs text-muted-foreground/90 mt-2 pl-5 tracking-tight leading-relaxed">
                        {inf.ultimo_sync
                          ? `sync ${formatDataHora(inf.ultimo_sync)}`
                          : "sem sync"}{" "}
                        · {inf.filmes.toLocaleString()} f ·{" "}
                        {inf.series_unicas.toLocaleString()} s ·{" "}
                        {inf.episodios.toLocaleString()} ep
                      </div>
                    )}
                    {msgObj && (
                      <div
                        className={`text-[11px] font-medium mt-1.5 pl-5 tracking-tight flex items-center gap-1.5 ${msgObj.type === "success" ? "text-emerald-500" : "text-rose-500"}`}
                      >
                        {msgObj.type === "success" ? (
                          <CheckCircle size={12} />
                        ) : (
                          <AlertTriangle size={12} />
                        )}
                        {msgObj.text}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={onSync}
                    disabled={running}
                    className={`shrink-0 h-9 w-32 justify-center rounded-lg font-bold text-xs flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-wait shadow-sm text-white ${bgClass}`}
                  >
                    <RefreshCw
                      size={12}
                      className={running ? "animate-spin" : "none"}
                    />
                    {running ? "Rodando..." : "Sincronizar"}
                  </button>
                </div>
              </div>
            );
          })}

          <div
            className={`p-5 rounded-xl border bg-card transition-all ${tmdbStatus === "ok" ? "border-amber-500/30" : tmdbStatus === "error" ? "border-rose-500/30" : tmdbStatus === "running" ? "border-amber-500/30 shadow-lg shadow-amber-900/10" : "border-border"}`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${tmdbStatus === "ok" ? "bg-amber-500" : tmdbStatus === "error" ? "bg-rose-500" : tmdbStatus === "running" ? "bg-amber-500 animate-pulse" : "bg-amber-500"}`}
                  />
                  <span className="text-sm font-semibold text-foreground tracking-tight">
                    Enriquecimento TMDB
                  </span>
                </div>
                {tmdbInfo && (
                  <div className="text-xs text-muted-foreground/90 mt-2 pl-5 tracking-tight leading-relaxed">
                    F: {tmdbInfo.filmes.com_tmdb.toLocaleString()} com ·{" "}
                    {tmdbInfo.filmes.sem_tmdb.toLocaleString()} faltam · S:{" "}
                    {tmdbInfo.series.com_tmdb.toLocaleString()} com ·{" "}
                    {tmdbInfo.series.sem_tmdb.toLocaleString()} faltam
                  </div>
                )}
                {tmdbMessage && (
                  <div
                    className={`text-[11px] font-medium mt-1.5 pl-5 tracking-tight flex items-center gap-1.5 ${tmdbMessage.type === "success" ? "text-emerald-500" : "text-rose-500"}`}
                  >
                    {tmdbMessage.type === "success" ? (
                      <CheckCircle size={12} />
                    ) : (
                      <AlertTriangle size={12} />
                    )}
                    {tmdbMessage.text}
                  </div>
                )}
              </div>
              <button
                onClick={() => setTmdbConfirm((v) => !v)}
                disabled={tmdbStatus === "running"}
                className={`shrink-0 h-9 w-32 justify-center rounded-lg font-bold text-xs flex items-center gap-2 transition-all bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-md`}
              >
                <RefreshCw
                  size={12}
                  className={tmdbStatus === "running" ? "animate-spin" : "none"}
                />
                {tmdbStatus === "running" ? "Rodando..." : "Enriquecer"}
              </button>
            </div>
            {tmdbConfirm && (
              <div className="mt-4 p-4 rounded-xl bg-background border border-border animate-in slide-in-from-top-2">
                <div className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3">
                  Iniciar Enriquecimento Automático
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3.5">
                    {tmdbInfo && (
                      <div className="text-xs font-medium text-foreground">
                        {(
                          tmdbInfo.filmes.sem_tmdb + tmdbInfo.series.sem_tmdb
                        ).toLocaleString()}{" "}
                        títulos aguardando enriquecimento.
                      </div>
                    )}
                    <button
                      onClick={syncTmdb}
                      disabled={tmdbStatus === "running"}
                      className="h-8 px-4 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow disabled:opacity-50 disabled:cursor-wait"
                    >
                      Iniciar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <LimparCatalogo />
        </ModalBody>

        <ModalFooter className="block">
          <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-2 leading-relaxed">
            <RefreshCw size={10} className="text-muted-foreground/60" /> Títulos
            já existentes são ignorados — apenas novos registros são
            contabilizados.
          </div>
        </ModalFooter>
      <div className="fixed inset-x-0 top-3 z-[999999] px-4 sm:px-6 pointer-events-none">
        <div className="pointer-events-auto max-w-sm ml-auto">
          <ToastNotifications toasts={toasts} removeToast={removeToast} />
        </div>
      </div>
    </Modal>
  );
}

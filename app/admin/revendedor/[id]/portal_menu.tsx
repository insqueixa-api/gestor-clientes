"use client";
// app/admin/revendedor/[id]/portal_menu.tsx
// ✅ 06/10/2026: botão "Portal" da revenda — mesmo visual do menu Portal do
// cliente (app/admin/cliente/[id]/page.tsx): acessar, copiar link, trocar
// link, desvincular/vincular. Rota: app/api/admin/resellers/portal-access.
import { useEffect, useState } from "react";
import { ChevronDown, Copy, ExternalLink, KeyRound, Link2, Link2Off, Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/hooks/useConfirm";

type Info = { unlinked: boolean; archived: boolean; has_link: boolean; link_last_used_at: string | null };

export default function PortalRevendaMenu({
  resellerId,
  onToast,
}: {
  resellerId: string;
  onToast: (type: "success" | "error", title: string, message?: string) => void;
}) {
  const { confirm } = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);

  async function call(payload: Record<string, unknown>) {
    const { data: sess } = await supabaseBrowser.auth.getSession();
    const res = await fetch("/api/admin/resellers/portal-access", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
      body: JSON.stringify({ reseller_id: resellerId, ...payload }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Erro inesperado.");
    return json;
  }

  async function refresh() {
    try {
      setInfo((await call({ action: "info" })) as Info);
    } catch {}
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resellerId]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("[data-reseller-portal-menu]")) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function openPortal() {
    setOpen(false);
    // abre a aba já no clique (evita bloqueio de pop-up)
    const win = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const j = await call({ action: "open" });
      const url = `/revenda?session=${encodeURIComponent(j.session_token)}`;
      if (win) win.location.href = url;
      else window.open(url, "_blank");
    } catch (e: any) {
      win?.close();
      onToast("error", "Não deu pra abrir o Portal", e?.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(rotate: boolean) {
    setOpen(false);
    if (rotate) {
      const ok = await confirm({
        title: "Trocar o link do Portal?",
        subtitle: "O link atual para de funcionar e quem estiver com o portal aberto é desconectado. Mensagens novas já vão com o link novo.",
        tone: "amber",
        confirmText: "Trocar link",
        cancelText: "Voltar",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const j = await call({ action: rotate ? "rotate" : "link" });
      try {
        await navigator.clipboard.writeText(j.url);
        onToast("success", rotate ? "Link trocado e copiado" : "Link copiado", j.url);
      } catch {
        onToast("success", rotate ? "Link trocado" : "Link do Portal", j.url);
      }
      await refresh();
    } catch (e: any) {
      onToast("error", "Falha no link do Portal", e?.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleUnlink(unlink: boolean) {
    setOpen(false);
    const ok = await confirm({
      title: unlink ? "Desvincular do Portal?" : "Vincular de novo ao Portal?",
      subtitle: unlink
        ? "O link atual para de funcionar e a revenda é desconectada. Mensagens com {link_pagamento} vão sem link até vincular de novo."
        : "A revenda volta a ter acesso. Um link novo é gerado no próximo envio (ou em Copiar link).",
      tone: unlink ? "rose" : "emerald",
      confirmText: unlink ? "Desvincular" : "Vincular",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await call({ action: unlink ? "unlink" : "relink" });
      onToast("success", unlink ? "Desvinculada do Portal" : "Vinculada ao Portal");
      await refresh();
    } catch (e: any) {
      onToast("error", "Falha", e?.message);
    } finally {
      setBusy(false);
    }
  }

  const item = "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors disabled:opacity-50 disabled:hover:bg-transparent";
  const linkBlocked = !!info?.unlinked || !!info?.archived;

  return (
    <div className="relative" data-reseller-portal-menu>
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!info) void refresh();
        }}
        disabled={busy}
        className="h-9 px-3 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-500 font-medium text-xs hover:bg-violet-500/20 transition-all shadow-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
        title="Portal da Revenda"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
        <span className="hidden sm:inline">Portal</span>
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-72 rounded-xl border border-border bg-card shadow-xl py-1 text-sm">
          <button type="button" onClick={openPortal} className={item}>
            <ExternalLink className="w-4 h-4 text-violet-500" />
            <span>
              Acessar o Portal
              {info?.unlinked && <span className="block text-[11px] text-muted-foreground">Desvinculada — só você acessa por aqui</span>}
            </span>
          </button>

          <div className="border-t border-border my-1" />
          <button type="button" disabled={linkBlocked} onClick={() => void copyLink(false)} className={item}>
            <Copy className="w-4 h-4 text-sky-500" />
            <span>
              Copiar link de acesso
              <span className="block text-[11px] text-muted-foreground">
                {info?.archived
                  ? "Revenda arquivada"
                  : info?.unlinked
                    ? "Vincule de novo antes"
                    : info?.has_link
                      ? info.link_last_used_at
                        ? `Último acesso ${new Date(info.link_last_used_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                        : "Link ainda não usado"
                      : "Gera o link na hora"}
              </span>
            </span>
          </button>
          <button type="button" disabled={linkBlocked} onClick={() => void copyLink(true)} className={item}>
            <KeyRound className="w-4 h-4 text-amber-500" />
            Trocar link mágico
          </button>

          <div className="border-t border-border my-1" />
          {info?.unlinked ? (
            <button type="button" onClick={() => void toggleUnlink(false)} className={item}>
              <Link2 className="w-4 h-4 text-emerald-500" />
              Vincular de novo ao portal
            </button>
          ) : (
            <button type="button" onClick={() => void toggleUnlink(true)} className={item}>
              <Link2Off className="w-4 h-4 text-rose-500" />
              Desvincular do portal
            </button>
          )}
        </div>
      )}
    </div>
  );
}

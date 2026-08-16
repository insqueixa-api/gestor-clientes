"use client";
// app/admin/gerenciador/cobranca/ImpactListModal.tsx
// Extraído de page.tsx (15/08/2026) — modal "Clientes Afetados Hoje", carrega
// via next/dynamic só quando abre.
import { useState, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { type ClientLight, BILLING_TZ } from "./shared";

function formatDateSP(input?: string | null): string {
  if (!input) return "--";
  let d = new Date(input);
  if (isNaN(d.getTime())) return "--";

  // ✅ Blindagem contra shift de timezone em datas YYYY-MM-DD
  if (input.length === 10 && input.includes("-")) {
    d = new Date(`${input}T12:00:00-03:00`);
  }
  return d.toLocaleDateString("pt-BR", { timeZone: BILLING_TZ });
}

// ✅ NOVO: Função para ler a hora que já vem do banco
function formatTimeSP(input?: string | null): string {
  if (!input) return "";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "";
  // Se veio apenas a data YYYY-MM-DD, não temos hora exata
  if (input.length === 10 && input.includes("-")) return "";

  return d.toLocaleTimeString("pt-BR", {
    timeZone: BILLING_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ImpactListModal({
  data,
  onClose,
}: {
  data: {
    ruleId: string;
    ruleName: string;
    clients: ClientLight[];
    ruleDateField?: string;
  };
  onClose: () => void;
}) {
  const tenantId = useTenantId();
  // Descobre se a regra usa vencimento ou data de criação
  const isCadastro =
    data.ruleDateField === "cadastro" || data.ruleDateField === "created_at";

  // ✅ Status de envio (mais recente) desta regra, por cliente
  const [sendStatusMap, setSendStatusMap] = useState<
    Record<string, { status: string; error_message: string | null }>
  >({});

  useEffect(() => {
    let cancelled = false;

    async function loadSendStatus() {
      const tid = tenantId;
      if (!tid) return;

      const clientIds = data.clients.map((c) => c.id).filter(Boolean);
      if (clientIds.length === 0) return;

      const { data: jobs, error } = await supabaseBrowser
        .from("client_message_jobs")
        .select("client_id, status, error_message, send_at")
        .eq("tenant_id", tid)
        .eq("automation_id", data.ruleId)
        .in("client_id", clientIds)
        .order("send_at", { ascending: false });

      if (error || !jobs || cancelled) return;

      // Mantém apenas o job mais recente de cada cliente (jobs já vêm ordenados desc)
      const map: Record<
        string,
        { status: string; error_message: string | null }
      > = {};
      for (const j of jobs as any[]) {
        if (!j.client_id || map[j.client_id]) continue;
        map[j.client_id] = { status: j.status, error_message: j.error_message };
      }

      if (!cancelled) setSendStatusMap(map);
    }

    loadSendStatus();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.ruleId]);

  function renderSendStatus(clientId: string) {
    const info = sendStatusMap[clientId];
    if (!info)
      return (
        <span className="text-[10px] text-muted-foreground/60 font-medium">
          Ainda não enviado
        </span>
      );

    if (info.status === "SENT")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
          ✅ Enviado
        </span>
      );
    if (info.status === "FAILED")
      return (
        <div className="flex flex-col gap-0.5">
          <span className="gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-rose-500/10 text-rose-500 border border-rose-500/20 w-fit">
            ❌ Falhou
          </span>
          {info.error_message && (
            <span
              className="text-[9px] text-rose-500/80 max-w-[160px] truncate"
              title={info.error_message}
            >
              {info.error_message}
            </span>
          )}
        </div>
      );
    if (info.status === "CANCELLED")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-muted text-muted-foreground border border-border">
          Resolvido
        </span>
      );
    // SCHEDULED / QUEUED / SENDING
    return (
      <span className="gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-sky-500/10 text-sky-500 border border-sky-500/20">
        ⏳ Na fila
      </span>
    );
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <ModalHeader onClose={onClose}>
        <h3 className="text-lg font-medium text-foreground">
          Clientes Afetados Hoje
        </h3>
        <p className="text-xs text-foreground/70">
          Regra: <strong>{data.ruleName}</strong> • Total:{" "}
          <strong>{data.clients.length}</strong>
        </p>
      </ModalHeader>

        <ModalBody className="p-2 overflow-x-auto">
          {data.clients.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground italic">
              Nenhum cliente atende a esta regra hoje.
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[820px]">
              <thead className="bg-muted/40 sticky top-0 z-10 text-xs uppercase text-muted-foreground font-medium">
                <tr>
                  <th className="p-3">Cliente / Contato</th>
                  <th className="p-3">Acesso / Servidor</th>
                  <th className="p-3 whitespace-nowrap">
                    {isCadastro ? "Data Cadastro" : "Vencimento"}
                  </th>
                  <th className="p-3">Plano</th>
                  <th className="p-3">Envio</th>
                </tr>
              </thead>
              <tbody className="text-sm text-foreground/80 divide-y divide-border">
                {data.clients.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-muted/30 transition-colors align-top"
                  >
                    {/* COLUNA 1: CLIENTES E WHATSAPP */}
                    <td className="p-3">
                      {/* Principal */}
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground flex items-center gap-1.5">
                          {c.display_name}
                          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium uppercase">
                            Titular
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          📞 {c.whatsapp_username || "--"}
                        </span>
                      </div>

                      {/* Secundário (só aparece se tiver) */}
                      {c.secondary_display_name && (
                        <div className="flex flex-col mt-2.5 pt-2 border-t border-border">
                          <span className="font-medium text-foreground/90 text-xs flex items-center gap-1.5">
                            {c.secondary_display_name}
                            <span className="text-[9px] bg-sky-500/10 text-sky-500 px-1.5 py-0.5 rounded font-medium uppercase">
                              Secundário
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            📞 {c.secondary_whatsapp_username || "--"}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* COLUNA 2: SERVIDOR E LOGIN */}
                    <td className="p-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground text-sm">
                          {c.username || (
                            <span className="text-muted-foreground italic font-medium">
                              Sem usuário
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {c.server_name || "--"}
                        </span>
                      </div>
                    </td>

                    {/* COLUNA 3: DATA (Dinâmica dependendo da regra) */}
                    <td className="p-3 whitespace-nowrap">
                      <div className="flex items-start gap-2">
                        <span className="text-base mt-0.5">
                          {isCadastro ? "📝" : "📅"}
                        </span>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground leading-tight">
                            {formatDateSP(
                              isCadastro ? c.created_at : c.vencimento,
                            )}
                          </span>
                          {formatTimeSP(
                            isCadastro ? c.created_at : c.vencimento,
                          ) && (
                            <span className="text-xs text-muted-foreground mt-0.5">
                              ⏰{" "}
                              {formatTimeSP(
                                isCadastro ? c.created_at : c.vencimento,
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* COLUNA 4: PLANO E VALOR */}
                    <td className="p-3">
                      <div className="flex flex-col items-start gap-1">
                        <span className="px-2 py-0.5 rounded bg-transparent border border-border text-xs font-medium text-foreground/90">
                          {c.plan_label || "Sem plano"}
                        </span>
                        {c.price_amount > 0 && (
                          <span className="text-xs font-medium text-emerald-500 pl-1">
                            {new Intl.NumberFormat("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            }).format(c.price_amount)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* COLUNA 5: STATUS DE ENVIO */}
                    <td className="p-3">{renderSendStatus(c.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ModalBody>

        <ModalFooter>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg bg-foreground text-background font-medium text-xs uppercase hover:bg-foreground/90 transition-colors shadow-md"
          >
            Fechar
          </button>
        </ModalFooter>
    </Modal>
  );
}

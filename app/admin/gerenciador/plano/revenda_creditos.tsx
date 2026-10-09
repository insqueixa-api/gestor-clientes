"use client";
// app/admin/gerenciador/plano/revenda_creditos.tsx
// ✅ 06/10/2026, pedido do Márcio: "Tabela Revenda" — 5 pacotes de crédito
// (quantidade + preço, só BRL) por servidor que envia crédito pela API.
// Uma tabela só, uma linha por servidor (NaTV primeiro). Os preços vão
// direto pra Recarga rápida da revenda. Dados em reseller_credit_packages
// (docs/sql/reseller_credit_packages.sql) — separada de plan_tables de
// propósito (não pode aparecer nos planos de cliente).
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { defaultCreditPackages, minCreditTransfer, supportsCreditTransfer } from "@/lib/integrations/credit-transfer";

type Pkg = { position: number; credits: string; price: string };
// ✅ 09/10/2026: min = mínimo de créditos por envio do painel (NaTV 5, Elite 20)
type ServerRow = { id: string; name: string; logo_url: string | null; packages: Pkg[]; min: number };

function fmtBRL(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

async function loadRows(tenantId: string): Promise<ServerRow[]> {
  const [srvRes, integRes, pkgRes] = await Promise.all([
    supabaseBrowser
      .from("servers")
      .select("id, name, logo_url, panel_integration")
      .eq("tenant_id", tenantId)
      .eq("is_archived", false)
      .order("name", { ascending: true }),
    supabaseBrowser.from("server_integrations").select("id, provider").eq("tenant_id", tenantId),
    supabaseBrowser
      .from("reseller_credit_packages")
      .select("server_id, position, credits, price_brl")
      .eq("tenant_id", tenantId),
  ]);
  if (srvRes.error) throw srvRes.error;
  if (integRes.error) throw integRes.error;
  if (pkgRes.error) throw pkgRes.error;

  const providerById = new Map((integRes.data || []).map((i: any) => [String(i.id), String(i.provider || "")]));
  return (srvRes.data || [])
    .filter((s: any) => s.panel_integration && supportsCreditTransfer(providerById.get(String(s.panel_integration))))
    .map((s: any) => {
      const saved = (pkgRes.data || []).filter((p: any) => p.server_id === s.id);
      const provider = providerById.get(String(s.panel_integration));
      const packages: Pkg[] = defaultCreditPackages(provider).map((def, idx) => {
        const row = saved.find((p: any) => Number(p.position) === idx + 1);
        return {
          position: idx + 1,
          credits: String(row?.credits ?? def),
          price: row?.price_brl != null ? String(Number(row.price_brl)) : "",
        };
      });
      return { id: s.id, name: s.name, logo_url: s.logo_url ?? null, packages, min: minCreditTransfer(provider) };
    });
}

function ServerBadge({ row }: { row: ServerRow }) {
  return (
    <div className="flex items-center gap-2">
      {row.logo_url ? (
        <img src={row.logo_url} alt={row.name} className="w-6 h-6 rounded-md object-cover border border-border" />
      ) : (
        <div className="w-6 h-6 rounded-md border border-border flex items-center justify-center text-[10px] text-muted-foreground">
          {row.name.charAt(0)}
        </div>
      )}
      <span className="text-xs font-medium text-muted-foreground tracking-tight">{row.name}</span>
    </div>
  );
}

export default function RevendaCreditosCard({ tenantId }: { tenantId: string | null }) {
  const [rows, setRows] = useState<ServerRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  async function refresh() {
    if (!tenantId) return;
    try {
      setLoadErr(null);
      setRows(await loadRows(tenantId));
    } catch (e: any) {
      setLoadErr(e?.message || "Erro ao carregar a Tabela Revenda");
      setRows([]);
    }
  }

  useEffect(() => {
    refresh();
  }, [tenantId]);

  // Sem servidor com envio de crédito integrado → não mostra nada
  if (!rows || (rows.length === 0 && !loadErr)) return null;

  return (
    <div className="bg-card border border-border rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="text-amber-500">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" />
          </svg>
        </span>
        <span className="text-sm font-medium text-foreground/90">Revenda (créditos)</span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="bg-card rounded-xl overflow-hidden shadow-sm border border-border">
          <div className="px-5 py-3 flex justify-between items-center border-b border-border">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-medium text-foreground tracking-tight">Tabela Revenda</h2>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest bg-muted px-2 py-0.5 rounded">
                BRL
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExpanded((v) => !v)}
                className="p-1.5 rounded-lg bg-muted border border-border text-muted-foreground hover:bg-muted/70 transition-all shadow-sm"
                title={expanded ? "Minimizar tabela" : "Maximizar tabela"}
              >
                {expanded ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12h12" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 transition-all shadow-sm"
                title="Editar pacotes e preços"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </button>
            </div>
          </div>

          {loadErr && <div className="p-4 text-sm text-rose-500">{loadErr}</div>}

          {expanded && (
            <div className="p-4 sm:p-5 space-y-6">
              {rows.map((row) => (
                <div key={row.id}>
                  <div className="mb-3 ml-1">
                    <ServerBadge row={row} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {row.packages.map((p) => (
                      <div
                        key={p.position}
                        className="border border-border rounded-xl px-3 py-2.5 flex flex-col justify-center h-16"
                      >
                        <span className="text-[10px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-lg border border-emerald-500/10 self-start mb-1">
                          {p.credits} cr
                        </span>
                        <div className="text-sm font-medium text-foreground tracking-tight">
                          {p.price === "" ? "A definir" : `${fmtBRL(Number(p.price))}/cr`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && tenantId && (
        <RevendaCreditosModal
          tenantId={tenantId}
          initial={rows}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function RevendaCreditosModal({
  tenantId,
  initial,
  onClose,
  onSaved,
}: {
  tenantId: string;
  initial: ServerRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<ServerRow[]>(() => initial.map((r) => ({ ...r, packages: r.packages.map((p) => ({ ...p })) })));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setPkg(serverId: string, position: number, patch: Partial<Pkg>) {
    setRows((prev) =>
      prev.map((r) =>
        r.id !== serverId ? r : { ...r, packages: r.packages.map((p) => (p.position === position ? { ...p, ...patch } : p)) },
      ),
    );
  }

  async function handleSave() {
    setErr(null);
    const payload: any[] = [];
    for (const r of rows) {
      for (const p of r.packages) {
        const credits = Number(p.credits);
        // mínimo do painel: NaTV 5 (4 só se a revenda tiver exatamente 1); Elite 20
        if (!Number.isInteger(credits) || credits < r.min) {
          setErr(`${r.name}: cada pacote precisa de no mínimo ${r.min} créditos (número inteiro).`);
          return;
        }
        const priceRaw = String(p.price).trim().replace(",", ".");
        const price = priceRaw === "" ? null : Number(priceRaw);
        if (price !== null && (!Number.isFinite(price) || price < 0)) {
          setErr(`${r.name}: preço inválido no pacote de ${credits} créditos.`);
          return;
        }
        payload.push({ tenant_id: tenantId, server_id: r.id, position: p.position, credits, price_brl: price });
      }
    }
    setSaving(true);
    try {
      const { error } = await supabaseBrowser
        .from("reseller_credit_packages")
        .upsert(payload, { onConflict: "tenant_id,server_id,position" });
      if (error) throw error;
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <ModalHeader
        actions={
          <>
            <button
              onClick={onClose}
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-muted-foreground hover:bg-muted text-xs sm:text-sm font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 sm:px-6 py-1.5 sm:py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs sm:text-sm font-medium shadow-lg shadow-emerald-900/20 transition-all"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </>
        }
      >
        <h2 className="text-base sm:text-lg font-medium text-foreground tracking-tight">Tabela Revenda</h2>
      </ModalHeader>

      <ModalBody className="bg-card">
        <div className="p-4 sm:p-6 space-y-8">
          {err && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-sm">{err}</div>
          )}
          {rows.map((r) => (
            <div key={r.id} className="animate-in slide-in-from-left-2 duration-300">
              <div className="mb-3 ml-1">
                <ServerBadge row={r} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                {r.packages.map((p) => (
                  <div
                    key={p.position}
                    className="border border-border rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col justify-center h-16 sm:h-20 focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all"
                  >
                    <div className="flex justify-between items-center w-full mb-1 gap-1">
                      <span className="text-[10px] sm:text-[11px] font-medium text-muted-foreground">A partir de</span>
                      <span className="flex items-center text-[9px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-lg border border-emerald-500/10">
                        <input
                          type="number"
                          min={r.min}
                          step={1}
                          value={p.credits}
                          onChange={(e) => setPkg(r.id, p.position, { credits: e.target.value.replace(/\D/g, "") })}
                          className="w-8 bg-transparent border-none p-0 text-right text-[10px] font-semibold text-emerald-500 outline-none focus:ring-0"
                          aria-label="Quantidade de créditos"
                        />
                        <span className="ml-0.5">cr</span>
                      </span>
                    </div>
                    <div className="relative">
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">R$</span>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={p.price}
                        onChange={(e) => setPkg(r.id, p.position, { price: e.target.value })}
                        className="w-full bg-transparent border-none p-0 pl-6 sm:pl-7 text-sm sm:text-base font-medium text-foreground focus:ring-0 outline-none placeholder-muted-foreground/60"
                        placeholder="0,00"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ModalBody>

      <ModalFooter className="flex justify-between items-center">
        <span className="text-[10px] text-muted-foreground italic">
          * Só BRL · preço POR CRÉDITO a partir da quantidade · mínimo 5 (regra do NaTV)
        </span>
        <span className="text-[10px] text-muted-foreground">A Recarga rápida usa a faixa pela quantidade digitada</span>
      </ModalFooter>
    </Modal>
  );
}

"use client";

// components/whatsapp/AppVarPicker.tsx
// ✅ 05/10/2026, pedido do Márcio: no "Enviar agora"/"Agendar" das páginas
// de Cliente e Teste, quando o texto usa {app_nome}/{app_vencimento} (ex:
// template "Aplicativo Renovado"), pergunta QUAL aplicativo do cliente —
// nome + ambiente, validade e MAC, pra não errar quando ele tem vários.
// Sem isso as variáveis saíam vazias (só a renovação automática preenchia).
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatDateBR } from "@/lib/date-br";

export type PickedApp = {
  id: string;
  name: string; // já com ambiente, ex: "IBO Player (Sala)"
  expiration: string | null; // YYYY-MM-DD
};

const APP_VARS_RE = /\{app_(nome|vencimento)\}/;

export function messageUsesAppVars(text: string | null | undefined): boolean {
  return APP_VARS_RE.test(String(text || ""));
}

// Preenche {app_nome}/{app_vencimento} no texto (usado no agendamento: a
// fila não tem de onde tirar o app, então o texto já vai resolvido).
export function fillAppVars(text: string, app: PickedApp | null): string {
  if (!app) return text;
  return text
    .split("{app_nome}").join(app.name)
    .split("{app_vencimento}").join(app.expiration ? formatDateBR(app.expiration, "") : "");
}

type Row = PickedApp & { mac: string | null };

// Mesma regra do portal (app/api/client-portal/apps/list::extractExpiration).
function extractExpiration(vals: Record<string, any>, config: any[]): string | null {
  let exp = vals["Vencimento"] || vals["vencimento"] || vals["VENCIMENTO"] || null;
  if (!exp) {
    const dateField = config.find((f: any) => f.type === "date" || /vencimento/i.test(f.label || ""));
    if (dateField) exp = vals[dateField.id] || vals[dateField.label] || null;
  }
  if (!exp) {
    exp = Object.values(vals).find((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) || null;
  }
  return exp ? String(exp).slice(0, 10) : null;
}

export default function AppVarPicker({
  tenantId,
  clientId,
  messageText,
  value,
  onChange,
}: {
  tenantId: string | null | undefined;
  clientId: string | null | undefined;
  messageText: string;
  value: PickedApp | null;
  onChange: (app: PickedApp | null) => void;
}) {
  const needed = messageUsesAppVars(messageText);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!needed || !tenantId || !clientId) return;
    let cancelled = false;
    // Outro cliente (ou o texto passou a usar as variáveis): escolha anterior
    // não vale mais.
    onChange(null);
    setRows(null);
    (async () => {
      setError(null);
      const { data, error: err } = await supabaseBrowser
        .from("client_apps")
        .select("id, field_values, license_paid_until, apps(name, fields_config)")
        .eq("tenant_id", tenantId)
        .eq("client_id", clientId);
      if (cancelled) return;
      if (err) {
        setError("Não deu pra carregar os aplicativos do cliente.");
        setRows([]);
        return;
      }
      const list: Row[] = (data || []).map((ca: any) => {
        const vals = (ca.field_values || {}) as Record<string, any>;
        const config = Array.isArray(ca.apps?.fields_config) ? ca.apps.fields_config : [];
        const ambField = config.find((f: any) => f.type === "obs");
        const macField = config.find((f: any) => f.type === "mac");
        const ambiente = ambField ? String(vals[ambField.id] || "").trim() : "";
        const baseName = String(ca.apps?.name || "Aplicativo");
        return {
          id: ca.id,
          name: ambiente ? `${baseName} (${ambiente})` : baseName,
          expiration: extractExpiration(vals, config) || (ca.license_paid_until ? String(ca.license_paid_until).slice(0, 10) : null),
          mac: macField ? String(vals[macField.id] || "").trim() || null : null,
        };
      });
      setRows(list);
      // Só 1 app: já vem marcado.
      if (list.length === 1) onChange({ id: list[0].id, name: list[0].name, expiration: list[0].expiration });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, tenantId, clientId]);

  // Texto deixou de usar as variáveis (trocou o template): limpa a escolha.
  useEffect(() => {
    if (!needed && value) onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed]);

  if (!needed) return null;

  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3 space-y-2">
      <p className="text-xs font-bold text-foreground">📱 Qual aplicativo?</p>
      <p className="text-[11px] text-muted-foreground">
        A mensagem usa o nome/validade do aplicativo — escolha a qual deles você está se referindo.
      </p>
      {rows === null && <p className="text-xs text-muted-foreground">Carregando aplicativos...</p>}
      {error && <p className="text-xs text-rose-500">{error}</p>}
      {rows && rows.length === 0 && !error && (
        <p className="text-xs text-amber-600">Esse cliente não tem aplicativo cadastrado — as variáveis vão sair vazias.</p>
      )}
      {rows && rows.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {rows.map((r) => {
            const selected = value?.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onChange({ id: r.id, name: r.name, expiration: r.expiration })}
                className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                  selected ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-card hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-foreground truncate">{r.name}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {r.expiration ? `Validade ${formatDateBR(r.expiration, "")}` : "Sem validade"}
                  </span>
                </div>
                {r.mac && <div className="text-[10px] font-mono text-muted-foreground mt-0.5">MAC {r.mac}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

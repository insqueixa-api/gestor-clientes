"use client";

// app/admin/settings/api-server/GeminiCards.tsx
// ✅ 08/10/2026, pedido do Márcio: Gemini junto dos Parceiros, 2 cards lado
// a lado — "Gemini Paga" e "Gemini Gratuita". Cada um com a chave
// (mascarada) e a SUA ordem de modelos; Testar, Buscar modelos e Editar.
// Aplicativos (captcha) tentam a paga primeiro; o resto, a gratuita
// primeiro (lib/whatsapp/gemini-client.ts::callGemini). Se o Google
// aposentar ou sobrecarregar um modelo, troca aqui sem deploy.
import { useEffect, useState } from "react";
import { Loader2, Pencil, RefreshCcw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Side = { masked_key: string; source: string; models: string[] };
type TestResult = { model: string; ok: boolean; ms: number; status: string; text?: string };
type Config = {
  paid: Side;
  free: Side;
  available_models: { name: string; display_name: string; description: string }[];
  models_synced_at: string | null;
  last_test: Record<string, { at: string; results: TestResult[] }> | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabaseBrowser.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export default function GeminiCards({
  onToast,
  shown,
}: {
  onToast: (type: "success" | "error", title: string, msg?: string) => void;
  shown: boolean;
}) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/settings/gemini", { headers: await authHeaders() });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok) setCfg(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!shown) return null;
  return (
    <>
      <GeminiCard which="paid" title="Gemini Paga" badge="1ª nos aplicativos" order="order-6" cfg={cfg} loading={loading} reload={load} onToast={onToast} />
      <GeminiCard which="free" title="Gemini Gratuita" badge="1ª nos demais" order="order-7" cfg={cfg} loading={loading} reload={load} onToast={onToast} />
    </>
  );
}

function GeminiCard({
  which,
  title,
  badge,
  order,
  cfg,
  loading,
  reload,
  onToast,
}: {
  which: "paid" | "free";
  title: string;
  badge: string;
  order: string;
  cfg: Config | null;
  loading: boolean;
  reload: () => Promise<void>;
  onToast: (type: "success" | "error", title: string, msg?: string) => void;
}) {
  const side = cfg?.[which];
  const [editing, setEditing] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const test = cfg?.last_test?.[which] || null;
  const resultFor = (m: string) => test?.results?.find((r) => r.model === m) || null;
  const available = cfg?.available_models || [];
  const optionNames = [...new Set([...available.map((m) => m.name), ...models])];

  function startEdit() {
    setKeyInput("");
    setModels(side?.models?.length ? [...side.models] : []);
    setEditing(true);
  }

  async function save() {
    if (!models.filter(Boolean).length) {
      onToast("error", "Escolha pelo menos 1 modelo");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/gemini", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ which, api_key: keyInput.trim() || undefined, models: models.filter(Boolean) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha ao salvar");
      onToast("success", `${title} salva`);
      setEditing(false);
      await reload();
    } catch (e: any) {
      onToast("error", "Não deu pra salvar", e?.message);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/settings/gemini/test", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ which }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha no teste");
      const ok = (json.results as TestResult[]).filter((r) => r.ok).length;
      onToast(ok > 0 ? "success" : "error", `${title}: ${ok} de ${json.results.length} modelos respondendo`);
      await reload();
    } catch (e: any) {
      onToast("error", "Não deu pra testar", e?.message);
    } finally {
      setTesting(false);
    }
  }

  async function syncModels() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/settings/gemini/models", { method: "POST", headers: await authHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha ao buscar");
      onToast("success", `${json.models.length} modelos disponíveis encontrados`);
      await reload();
    } catch (e: any) {
      onToast("error", "Não deu pra buscar os modelos", e?.message);
    } finally {
      setSyncing(false);
    }
  }

  const move = (i: number, dir: -1 | 1) =>
    setModels((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const ordinal = (i: number) => `${i + 1}º`;
  // Mesmo botão/ícones dos outros cards de Parceiros (IconActionBtn em page.tsx)
  const btn = "p-1.5 rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className={`${order} rounded-none sm:rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-card border-border hover:border-emerald-500/30`}>
      <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-b border-border bg-transparent">
        <div className="flex items-center gap-2 min-w-0 pr-3">
          <div className="relative w-7 h-7 rounded-lg border border-border shrink-0 flex items-center justify-center overflow-hidden">
            <span className="text-sm">✨</span>
          </div>
          <h2 className="text-base font-medium truncate text-foreground/90 tracking-tight">{title}</h2>
          <span
            className={`inline-flex items-center text-[10px] font-medium px-2.5 py-0.5 rounded-full uppercase border ${
              which === "paid"
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                : "bg-sky-500/10 text-sky-500 border-sky-500/20"
            }`}
          >
            {badge}
          </span>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" title="Testar cada modelo com esta chave" onClick={runTest} disabled={testing || !side?.masked_key}
            className={`${btn} text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20`}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <IconPlay />}
          </button>
          <button type="button" title="Buscar modelos disponíveis no Google" onClick={syncModels} disabled={syncing}
            className={`${btn} text-sky-500 bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20`}>
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
          </button>
          <button type="button" title="Editar chave e modelos" onClick={startEdit}
            className={`${btn} text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20`}>
            <Pencil className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5 text-sm space-y-2">
        {!editing ? (
          <>
            <div className="flex justify-between items-center gap-3">
              <span className="text-muted-foreground">🔑 Chave</span>
              <span className="font-mono text-xs text-foreground/90 text-right">
                {side?.masked_key || (loading ? "carregando..." : "--")}
                {side?.source && side.source !== "painel" && side.masked_key && (
                  <span className="block font-sans text-[10px] text-muted-foreground">da variável de ambiente</span>
                )}
              </span>
            </div>
            <div className="pt-1 border-t border-border/60">
              <p className="text-muted-foreground pt-2 pb-1">🧠 Modelos (ordem de tentativa)</p>
              <div className="space-y-1">
                {(side?.models || []).map((m, i) => {
                  const r = resultFor(m);
                  return (
                    <div key={m} className="flex justify-between items-center gap-2">
                      <span className="text-xs text-foreground/90 truncate">
                        <span className="text-muted-foreground mr-1.5">{ordinal(i)}</span>
                        <span className="font-mono">{m}</span>
                      </span>
                      {r && (
                        <span
                          className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-lg ${
                            r.ok ? "text-emerald-600 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"
                          }`}
                          title={r.ok ? undefined : r.text}
                        >
                          {r.ok ? `ok · ${(r.ms / 1000).toFixed(1)}s` : r.status === "503" ? "sobrecarregado" : r.status === "404" ? "não existe mais" : r.status}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-border/60">
              <span className="text-muted-foreground text-xs pt-2">🧪 Último teste</span>
              <span className="text-xs text-foreground/80 pt-2">{fmtDateTime(test?.at)}</span>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="block text-[10px] uppercase font-medium text-muted-foreground">Nova chave (vazio = mantém a atual)</label>
              {/* ✅ type="text" com os caracteres escondidos por CSS, NÃO
                  type="password": campo de senha faz o Chrome preencher o
                  e-mail salvo na busca da página, que filtrava os cards e
                  "sumia" com tudo (achado do Márcio, 08/10/2026). */}
              <input
                type="text"
                name="gemini-key-input"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={side?.masked_key || "AIza..."}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                spellCheck={false}
                style={{ WebkitTextSecurity: keyInput ? "disc" : "none" } as React.CSSProperties}
                className="w-full h-9 px-2.5 bg-transparent border border-border rounded-lg text-xs font-mono text-foreground outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] uppercase font-medium text-muted-foreground">Modelos (ordem de tentativa)</label>
                {available.length === 0 && (
                  <button type="button" onClick={syncModels} className="text-[11px] text-sky-500 hover:underline">
                    {syncing ? "buscando..." : "buscar modelos disponíveis"}
                  </button>
                )}
              </div>
              {models.map((m, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-6 text-xs text-muted-foreground">{ordinal(i)}</span>
                  <select
                    value={m}
                    onChange={(e) => setModels((prev) => prev.map((x, k) => (k === i ? e.target.value : x)))}
                    className="flex-1 min-w-0 h-8 px-2 bg-transparent border border-border rounded-lg text-xs font-mono text-foreground outline-none focus:border-emerald-500/50"
                  >
                    {!m && <option value="">escolha…</option>}
                    {optionNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="h-8 w-7 rounded-lg border border-border text-xs disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === models.length - 1} className="h-8 w-7 rounded-lg border border-border text-xs disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => setModels((prev) => prev.filter((_, k) => k !== i))} className="h-8 w-7 rounded-lg border border-border text-xs text-rose-500">✕</button>
                </div>
              ))}
              {models.length < 6 && (
                <button type="button" onClick={() => setModels((prev) => [...prev, ""])} className="text-[11px] text-emerald-600 hover:underline">
                  + adicionar modelo
                </button>
              )}
              {cfg?.models_synced_at && (
                <p className="text-[10px] text-muted-foreground">Lista do Google atualizada em {fmtDateTime(cfg.models_synced_at)}</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="px-3 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={save} disabled={saving} className="px-3 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Mesmo desenho do IconPlay de page.tsx (padrão da página).
function IconPlay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

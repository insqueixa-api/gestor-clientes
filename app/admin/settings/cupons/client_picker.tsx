"use client";
// app/admin/settings/cupons/client_picker.tsx
// Busca simples de cliente por nome/usuário — usado no cupom pessoal
// (indicação). Não existe um componente compartilhado de busca de cliente
// no projeto; este é local à pasta de cupons, igual ao resto das
// páginas de settings (cada uma resolve seus próprios inputs).

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type PickedClient = { id: string; display_name: string; username: string | null };

export default function ClientPicker({
  tenantId,
  selected,
  onSelect,
  onClear,
}: {
  tenantId: string;
  selected: PickedClient | null;
  onSelect: (client: PickedClient) => void;
  onClear: () => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PickedClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await supabaseBrowser
          .from("clients")
          .select("id, display_name, username:server_username")
          .eq("tenant_id", tenantId)
          .eq("is_archived", false)
          .eq("price_currency", "BRL") // cupons são exclusivos de contas em BRL
          .or(`display_name.ilike.%${q}%,server_username.ilike.%${q}%`)
          .limit(8);
        setResults((data as PickedClient[]) || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, tenantId]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 h-10 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3">
        <span className="text-sm font-medium text-foreground/90 truncate">
          {selected.display_name}
          {selected.username ? (
            <span className="text-muted-foreground"> ({selected.username})</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Buscar por nome ou usuário..."
          className="w-full h-10 rounded-xl border border-border bg-transparent pl-9 pr-3 text-sm text-foreground/90 outline-none focus:ring-2 focus:ring-emerald-500/30"
        />
      </div>

      {open && (loading || results.length > 0) && (
        <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-card shadow-2xl overflow-hidden max-h-56 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2.5 text-xs text-muted-foreground">Buscando...</div>
          )}
          {!loading &&
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(c);
                  setTerm("");
                  setResults([]);
                  setOpen(false);
                }}
                className="w-full px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors border-b border-border last:border-b-0"
              >
                <span className="font-medium text-foreground/90">{c.display_name}</span>
                {c.username && (
                  <span className="text-muted-foreground"> ({c.username})</span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

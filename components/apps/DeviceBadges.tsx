"use client";
// components/apps/DeviceBadges.tsx
//
// Selos de aparelho compatível. ✅ 02/10/2026 (pedido do Márcio): voltou a
// ser só o NOME em badge, sem logo (as logos de marca de 30/09 saíram) —
// também cobre aparelhos cadastrados à mão (ex: "PS5"), ver deviceLabel().
// ✅ 05/10/2026 (pedido do Márcio): o aparelho escolhido na vitrine fica
// "ligado" (verde + ✓), pra deixar claro pra qual aparelho é a descrição.
import { Check } from "lucide-react";
import { deviceLabel } from "@/lib/apps/device-types";

export function DeviceBadge({ type, selected = false }: { type: string; selected?: boolean }) {
  return (
    <span
      className={
        selected
          ? "inline-flex items-center gap-1 h-6 px-2 rounded-md border border-emerald-600 bg-emerald-600 text-[11px] font-semibold text-white shadow-sm"
          : "inline-flex items-center h-6 px-2 rounded-md border border-border bg-muted/40 text-[11px] font-medium text-foreground/80"
      }
      aria-current={selected ? "true" : undefined}
    >
      {selected && <Check className="w-3 h-3" />}
      {deviceLabel(type)}
    </span>
  );
}

export default function DeviceBadges({
  types,
  selected,
}: {
  types: string[] | null | undefined;
  /** aparelho escolhido — badge destacado */
  selected?: string | null;
}) {
  if (!types?.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {types.map((t) => (
        <DeviceBadge key={t} type={t} selected={!!selected && t === selected} />
      ))}
    </span>
  );
}

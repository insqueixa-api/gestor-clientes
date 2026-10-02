"use client";
// components/apps/DeviceBadges.tsx
//
// Selos de aparelho compatível. ✅ 02/10/2026 (pedido do Márcio): voltou a
// ser só o NOME em badge, sem logo (as logos de marca de 30/09 saíram) —
// também cobre aparelhos cadastrados à mão (ex: "PS5"), ver deviceLabel().
import { deviceLabel } from "@/lib/apps/device-types";

export function DeviceBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center h-6 px-2 rounded-md border border-border bg-muted/40 text-[11px] font-medium text-foreground/80">
      {deviceLabel(type)}
    </span>
  );
}

export default function DeviceBadges({ types }: { types: string[] | null | undefined }) {
  if (!types?.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {types.map((t) => (
        <DeviceBadge key={t} type={t} />
      ))}
    </span>
  );
}

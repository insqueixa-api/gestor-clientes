// components/apps/TierStars.tsx
// Classificação do app em estrelas (apps.tier, 1 a 5) — sempre as 5
// (acesas = nível, apagadas = o resto). Usado no catálogo do admin e no
// portal do cliente.
import { Star } from "lucide-react";

export default function TierStars({ value, size = 14 }: { value: number | null | undefined; size?: number }) {
  const n = Number(value) || 0;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={n ? `${n} de 5 estrelas` : "Sem classificação"}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= n ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/30"}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}

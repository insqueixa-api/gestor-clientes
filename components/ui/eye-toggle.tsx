"use client";
// components/ui/eye-toggle.tsx
import { EyeOff } from "lucide-react";

import { useState } from "react";

export function EyeToggle() {
  const [hidden, setHidden] = useState(false);

  function toggle() {
    const next = !hidden;
    setHidden(next);
    document
      .getElementById("dashboard-values")
      ?.setAttribute("data-values-hidden", next ? "true" : "false");
  }

  return (
    <button
      onClick={toggle}
      title={hidden ? "Exibir valores" : "Ocultar valores"}
      className="
        group flex items-center gap-1.5
        px-2.5 py-1.5 rounded-lg
        border border-border
        bg-muted
        text-muted-foreground
        hover:text-foreground/90
        hover:border-foreground/20
        transition-all duration-200 text-xs font-medium shadow-sm
        select-none
      "
    >
      {hidden ? <EyeOffSvg /> : <EyeSvg />}
      <span className="hidden sm:inline text-[11px] tracking-wide">
        {hidden ? "Exibir" : "Ocultar"}
      </span>
    </button>
  );
}

function EyeSvg() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* contorno do olho */}
      <path d="M2 12S5.5 5 12 5s10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      {/* pupila */}
      <circle cx="12" cy="12" r="2.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EyeOffSvg() {
  return <EyeOff className="w-4 h-4" />;
}

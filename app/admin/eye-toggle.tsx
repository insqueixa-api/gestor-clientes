"use client";
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
        border border-zinc-200 dark:border-zinc-700
        bg-white dark:bg-zinc-900
        text-zinc-400 dark:text-zinc-500
        hover:text-zinc-700 dark:hover:text-zinc-200
        hover:border-zinc-400 dark:hover:border-zinc-500
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
      <path d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
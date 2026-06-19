"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import GuiaTVView from "@/app/components/guia-tv/GuiaTVView";

type ServidorFiltro = "ELITE" | "NATV" | "FAST" | "TODOS";

const SERVIDOR_MAP: Record<string, ServidorFiltro> = {
  ELITE: "ELITE",
  NATV: "NATV",
  FAST: "FAST",
  TODOS: "TODOS",
};

function GuiaTVCliente() {
  const sp = useSearchParams();
  const raw = (sp.get("servidor") ?? "").toUpperCase();
  const servidorFiltro = SERVIDOR_MAP[raw] ?? "TODOS";

  return <GuiaTVView servidorFiltro={servidorFiltro} modoCliente />;
}

export default function GuiaTVClientePage() {
  return (
    <Suspense>
      <GuiaTVCliente />
    </Suspense>
  );
}
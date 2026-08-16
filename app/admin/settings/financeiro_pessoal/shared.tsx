"use client";
// app/admin/settings/financeiro_pessoal/shared.tsx
// Pedaços usados tanto pelo que ficou em page.tsx (FinanceiroPageContent,
// ModalTransacao) quanto pelos modais extraídos pra next/dynamic
// (14/08/2026) — ícones, o wrapper <Modal>, os seletores de data e o tipo
// Transacao. Fica num lugar só pra não duplicar lógica.
import { useState } from "react";
import { X, Pencil, Trash2 } from "lucide-react";
import {
  Modal as SharedModal,
  ModalHeader,
  ModalBody,
} from "@/components/ui/Modal";

// --- TIPOS ---
export type Transacao = {
  id: string;
  tipo: "RECEITA" | "DESPESA";
  descricao: string;
  valor: number;
  data_vencimento: string;
  status: "PENDENTE" | "PAGO";
  categoria_nome?: string;
  conta_nome?: string;
  conta_id?: string;
  categoria_id?: string;
  parcela_atual?: number;
  parcela_total?: number;
  is_recorrente?: boolean;
  frequencia?: string;
  recorrencia_id?: string;
  observacoes?: string;
  data_pagamento?: string | null;
};

// --- ICONES ---
export function IconPlus() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  );
}
export function IconX() {
  return <X className="w-4 h-4" />;
}
export function IconChevronLeft() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
  );
}
export function IconChevronRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  );
}
export function IconChevronDown() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  );
}
export function IconTrendingUp() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
      <polyline points="17 6 23 6 23 12"></polyline>
    </svg>
  );
}
export function IconTrendingDown() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline>
      <polyline points="17 18 23 18 23 12"></polyline>
    </svg>
  );
}
export function IconThumb({ className = "" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-300 ${className}`}
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}
export function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
export function IconTrash() {
  return <Trash2 className="w-4 h-4" />;
}
export function IconCalendar() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>
  );
}

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function ModalDatePicker({
  currentDate,
  onSelect,
  onClose,
}: {
  currentDate: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
}) {
  const [ano, setAno] = useState(currentDate.getFullYear());
  const mesSelecionado = currentDate.getMonth();

  const anos = Array.from(
    { length: 10 },
    (_, i) => new Date().getFullYear() - 7 + i,
  );

  return (
    <SharedModal onClose={onClose} maxWidth="max-w-xs">
      <ModalHeader onClose={onClose}>
        <span className="text-sm font-medium text-foreground/90">
          Selecionar Período
        </span>
      </ModalHeader>

        <ModalBody>
          {/* Seletor de Ano */}
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Ano
            </label>
            <div className="flex items-center justify-between bg-transparent border border-border rounded-lg p-1">
              <button
                onClick={() => setAno((a) => a - 1)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <IconChevronLeft />
              </button>
              <span className="text-sm font-medium text-foreground/90 w-16 text-center">
                {ano}
              </span>
              <button
                onClick={() => setAno((a) => a + 1)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <IconChevronRight />
              </button>
            </div>
          </div>

          {/* Grid de Meses */}
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Mês
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {MESES.map((mes, idx) => {
                const isSelected =
                  idx === mesSelecionado && ano === currentDate.getFullYear();
                const isCurrentMonth =
                  idx === new Date().getMonth() &&
                  ano === new Date().getFullYear();
                return (
                  <button
                    key={mes}
                    onClick={() => {
                      const hoje = new Date().getDate();
                      const ultimoDiaDoMes = new Date(
                        ano,
                        idx + 1,
                        0,
                      ).getDate();
                      const diaCerto = Math.min(hoje, ultimoDiaDoMes);
                      onSelect(new Date(ano, idx, diaCerto));
                    }}
                    className={`py-2 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/20"
                        : isCurrentMonth
                          ? "border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
                          : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {mes.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </ModalBody>
    </SharedModal>
  );
}

export function ModalDayPicker({
  currentDate,
  onSelect,
  onClose,
}: {
  currentDate: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
}) {
  const [viewDate, setViewDate] = useState(currentDate);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const ano = viewDate.getFullYear();
  const mes = viewDate.getMonth();

  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const primeiroDiaDaSemana = new Date(ano, mes, 1).getDay();

  const dias = [];
  for (let i = 0; i < primeiroDiaDaSemana; i++) dias.push(null);
  for (let i = 1; i <= diasNoMes; i++) dias.push(i);

  const meses = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];

  return (
    <SharedModal onClose={onClose} maxWidth="max-w-xs">
      <ModalHeader onClose={onClose}>
        <span className="text-sm font-medium text-foreground/90">
          Selecionar Data
        </span>
      </ModalHeader>

        <ModalBody>
          <div className="flex items-center justify-between bg-transparent border border-border rounded-lg p-1">
            <button
              onClick={() => setViewDate(new Date(ano, mes - 1, 1))}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <IconChevronLeft />
            </button>
            <button
              onClick={() => setShowMonthPicker(true)}
              className="px-3 py-1 text-sm font-medium text-foreground/90 text-center capitalize hover:text-emerald-500 hover:bg-muted rounded-md transition-colors"
            >
              {meses[mes]} {ano}
            </button>
            <button
              onClick={() => setViewDate(new Date(ano, mes + 1, 1))}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <IconChevronRight />
            </button>
          </div>

          <div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                <div
                  key={i}
                  className="text-center text-[10px] font-medium text-muted-foreground py-1"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {dias.map((dia, idx) => {
                if (!dia) return <div key={`empty-${idx}`} />;
                const isSelected =
                  dia === currentDate.getDate() &&
                  mes === currentDate.getMonth() &&
                  ano === currentDate.getFullYear();
                const isToday =
                  dia === new Date().getDate() &&
                  mes === new Date().getMonth() &&
                  ano === new Date().getFullYear();
                return (
                  <button
                    key={idx}
                    onClick={() => onSelect(new Date(ano, mes, dia))}
                    className={`h-8 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/20"
                        : isToday
                          ? "border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
                          : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {dia}
                  </button>
                );
              })}
            </div>
          </div>
        </ModalBody>

      {showMonthPicker && (
        <ModalDatePicker
          currentDate={viewDate}
          onSelect={(date) => {
            setViewDate(date);
            setShowMonthPicker(false);
          }}
          onClose={() => setShowMonthPicker(false)}
        />
      )}
    </SharedModal>
  );
}

export function Modal({
  title,
  children,
  onClose,
  maxWidth = "max-w-lg",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  // ✅ 10/08/2026: a maioria desses é confirmação/formulário curto (1-3
  // campos) — max-w-3xl deixava a caixa enorme e vazia, com os botões
  // esticados/desproporcionais. Só ModalTransacao (formulário grande) pede
  // max-w-3xl explicitamente; o resto usa o padrão mais estreito.
  maxWidth?: string;
}) {
  return (
    <SharedModal onClose={onClose} maxWidth={maxWidth}>
      <ModalHeader onClose={onClose}>
        <div className="font-medium text-foreground">{title}</div>
      </ModalHeader>
      <ModalBody>{children}</ModalBody>
    </SharedModal>
  );
}

// ✅ Distribui centavos igualmente entre N parcelas sem perder/inventar
// centavo por arredondamento — a sobra da divisão vai pra última parcela da
// lista. Usado tanto pra criar um lançamento parcelado (ModalTransacao)
// quanto pra antecipar parcelas existentes (ModalBaixa) — antes o primeiro
// caso dividia o valor em ponto flutuante puro (Number(valor)/n), o que
// podia deixar a soma das parcelas 1-2 centavos diferente do total digitado.
export function distribuirCentavos(totalCents: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  const resto = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === n - 1 ? resto : 0));
}

"use client";
// app/admin/FormattedDateInput.tsx
// Input de data/data-hora mascarado em DD/MM/AAAA — substitui <input type="date">
// e <input type="datetime-local"> nativos, cujo formato de exibição depende do
// idioma do navegador (em inglês vira MM/DD/AAAA). Mantém o mesmo contrato de
// value/onChange (value em ISO "AAAA-MM-DD" ou "AAAA-MM-DDTHH:MM", onChange
// recebendo um evento com target.value), então é um substituto direto.

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

function BaseInput({ className = "", ...props }: InputProps) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

const MESES_NOME = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function ModalMonthPicker({
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

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[999999] bg-black/60 grid place-items-center p-4"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xs bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-transparent">
          <span className="text-sm font-medium text-foreground/90">Selecionar Período</span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Ano</label>
            <div className="flex items-center justify-between bg-transparent border border-border rounded-lg p-1">
              <button onClick={() => setAno((a) => a - 1)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-foreground/90 w-16 text-center">{ano}</span>
              <button onClick={() => setAno((a) => a + 1)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Mês</label>
            <div className="grid grid-cols-3 gap-1.5">
              {MESES_NOME.map((mes, idx) => {
                const isSelected = idx === mesSelecionado && ano === currentDate.getFullYear();
                const isCurrentMonth = idx === new Date().getMonth() && ano === new Date().getFullYear();
                return (
                  <button
                    key={mes}
                    onClick={() => {
                      const hoje = new Date().getDate();
                      const ultimoDia = new Date(ano, idx + 1, 0).getDate();
                      onSelect(new Date(ano, idx, Math.min(hoje, ultimoDia)));
                    }}
                    className={`py-2 rounded-lg text-xs font-medium transition-all ${
                      isSelected ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/20" : isCurrentMonth ? "border border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {mes.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ModalDayPicker({
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
  const primeiroDia = new Date(ano, mes, 1).getDay();

  const dias = Array(primeiroDia).fill(null).concat(Array.from({ length: diasNoMes }, (_, i) => i + 1));

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[999998] bg-black/60 grid place-items-center p-4"
    >
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-xs bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-transparent">
          <span className="text-sm font-medium text-foreground/90">Selecionar Data</span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between bg-transparent border border-border rounded-lg p-1">
            <button onClick={() => setViewDate(new Date(ano, mes - 1, 1))} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setShowMonthPicker(true)} className="px-3 py-1 text-sm font-medium text-foreground/90 text-center capitalize hover:text-emerald-500 hover:bg-muted rounded-md transition-colors">
              {MESES_NOME[mes]} {ano}
            </button>
            <button onClick={() => setViewDate(new Date(ano, mes + 1, 1))} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {dias.map((dia, idx) => {
                if (!dia) return <div key={`empty-${idx}`} />;
                const isSelected = dia === currentDate.getDate() && mes === currentDate.getMonth() && ano === currentDate.getFullYear();
                const isToday = dia === new Date().getDate() && mes === new Date().getMonth() && ano === new Date().getFullYear();
                return (
                  <button
                    key={idx}
                    onClick={() => onSelect(new Date(ano, mes, dia))}
                    className={`h-8 rounded-lg text-xs font-medium transition-all ${
                      isSelected ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/20" : isToday ? "border border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {dia}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {showMonthPicker && (
          <ModalMonthPicker
            currentDate={viewDate}
            onSelect={(date) => {
              setViewDate(date);
              setShowMonthPicker(false);
            }}
            onClose={() => setShowMonthPicker(false)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

type FormattedDateInputProps = {
  type: "date" | "datetime-local";
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  className?: string;
  /** Data máxima selecionável (ISO "AAAA-MM-DD"), mesmo comportamento do atributo `max` nativo. */
  max?: string;
  [key: string]: any;
};

export default function FormattedDateInput({
  type,
  value,
  onChange,
  className = "",
  max,
  ...props
}: FormattedDateInputProps) {
  const [displayValue, setDisplayValue] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const maxDate = max ? new Date(`${max}T23:59:59`) : null;

  useEffect(() => {
    if (!value) {
      setDisplayValue("");
      return;
    }
    try {
      if (type === "date") {
        const [y, m, d] = value.split("-");
        if (y && m && d) setDisplayValue(`${d}/${m}/${y}`);
      } else {
        const [datePart, timePart] = value.split("T");
        if (datePart && timePart) {
          const [y, m, d] = datePart.split("-");
          if (y && m && d) setDisplayValue(`${d}/${m}/${y} ${timePart}`);
        }
      }
    } catch {}
  }, [value, type]);

  const withinMax = (d: Date) => !maxDate || d.getTime() <= maxDate.getTime();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/\D/g, "");
    let formatted = "";

    if (type === "date") {
      raw = raw.slice(0, 8);
      if (raw.length > 4) {
        formatted = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4)}`;
      } else if (raw.length > 2) {
        formatted = `${raw.slice(0, 2)}/${raw.slice(2)}`;
      } else {
        formatted = raw;
      }

      setDisplayValue(formatted);

      if (raw.length === 8) {
        const d = raw.slice(0, 2);
        const m = raw.slice(2, 4);
        const y = raw.slice(4);
        if (
          Number(d) > 0 && Number(d) <= 31 &&
          Number(m) > 0 && Number(m) <= 12 &&
          withinMax(new Date(Number(y), Number(m) - 1, Number(d)))
        ) {
          onChange({ target: { value: `${y}-${m}-${d}` } });
        }
      } else if (raw.length === 0) {
        onChange({ target: { value: "" } });
      }
    } else {
      raw = raw.slice(0, 12);
      if (raw.length > 10) {
        formatted = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4, 8)} ${raw.slice(8, 10)}:${raw.slice(10)}`;
      } else if (raw.length > 8) {
        formatted = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4, 8)} ${raw.slice(8)}`;
      } else if (raw.length > 4) {
        formatted = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4)}`;
      } else if (raw.length > 2) {
        formatted = `${raw.slice(0, 2)}/${raw.slice(2)}`;
      } else {
        formatted = raw;
      }

      setDisplayValue(formatted);

      if (raw.length === 12) {
        const d = raw.slice(0, 2);
        const m = raw.slice(2, 4);
        const y = raw.slice(4, 8);
        const hh = raw.slice(8, 10);
        const mm = raw.slice(10, 12);
        if (Number(d) <= 31 && Number(m) <= 12 && Number(hh) <= 23 && Number(mm) <= 59) {
          onChange({ target: { value: `${y}-${m}-${d}T${hh}:${mm}` } });
        }
      } else if (raw.length === 0) {
        onChange({ target: { value: "" } });
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!value) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (type === "date") {
        const [y, m, d] = value.split("-");
        const newY = parseInt(y, 10) + (e.key === "ArrowUp" ? 1 : -1);
        if (withinMax(new Date(newY, Number(m) - 1, Number(d)))) {
          onChange({ target: { value: `${newY}-${m}-${d}` } });
        }
      } else {
        const [datePart, timePart] = value.split("T");
        const [y, m, d] = datePart.split("-");
        const newY = parseInt(y, 10) + (e.key === "ArrowUp" ? 1 : -1);
        onChange({ target: { value: `${newY}-${m}-${d}T${timePart}` } });
      }
    }
  };

  const getCurrentDateForPicker = () => {
    if (!value) return new Date();
    try {
      const datePart = type === "datetime-local" ? value.split("T")[0] : value;
      const [y, m, d] = datePart.split("-");
      return new Date(Number(y), Number(m) - 1, Number(d));
    } catch {
      return new Date();
    }
  };

  const handleDateSelect = (date: Date) => {
    if (!withinMax(date)) return;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");

    if (type === "date") {
      onChange({ target: { value: `${y}-${m}-${d}` } });
    } else {
      const timePart = value && value.includes("T") ? value.split("T")[1] : "00:00";
      onChange({ target: { value: `${y}-${m}-${d}T${timePart}` } });
    }
    setShowCalendar(false);
  };

  return (
    <div className="relative w-full flex items-center">
      <BaseInput
        type="text"
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={type === "date" ? "DD/MM/AAAA" : "DD/MM/AAAA HH:MM"}
        className={`${className} pr-10`}
        maxLength={type === "date" ? 10 : 16}
        title="Dica: Pressione Seta para Cima para adicionar +1 Ano rapidamente"
        {...props}
      />

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowCalendar(true);
        }}
        className="absolute right-0 top-0 h-full w-10 flex items-center justify-center text-muted-foreground/60 hover:text-emerald-500 transition-colors"
        tabIndex={-1}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>

      {showCalendar && (
        <ModalDayPicker
          currentDate={getCurrentDateForPicker()}
          onSelect={handleDateSelect}
          onClose={() => setShowCalendar(false)}
        />
      )}
    </div>
  );
}

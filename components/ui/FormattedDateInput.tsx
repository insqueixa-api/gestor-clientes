"use client";
// components/ui/FormattedDateInput.tsx
// Input de data/data-hora mascarado em DD/MM/AAAA — substitui <input type="date">
// e <input type="datetime-local"> nativos, cujo formato de exibição depende do
// idioma do navegador (em inglês vira MM/DD/AAAA). Mantém o mesmo contrato de
// value/onChange (value em ISO "AAAA-MM-DD" ou "AAAA-MM-DDTHH:MM", onChange
// recebendo um evento com target.value), então é um substituto direto.

//
// ✅ 03/10/2026: digitação "sobrescreve no lugar" (components/ui/overwriteMask.ts)
// — selecionar só o dia/mês/ano e digitar troca só aquele pedaço, sem deslizar
// os outros dígitos (antes 02/10/2026 virava 10/20/2608). Setas ↑/↓ mudam o
// pedaço onde está o cursor. "Hoje" do calendário = São Paulo, nunca o
// fuso/idioma do navegador.
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import {
  DATE_TEMPLATE,
  DATETIME_TEMPLATE,
  isoToText,
  textToIso,
  todaySP,
} from "./overwriteMask";
import { useOverwriteInput } from "./useOverwriteInput";

const sp = todaySP;

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> };

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
                const isCurrentMonth = idx === sp().m - 1 && ano === sp().y;
                return (
                  <button
                    key={mes}
                    onClick={() => {
                      const hoje = sp().d;
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
                const isToday = dia === sp().d && mes === sp().m - 1 && ano === sp().y;
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
  const template = type === "datetime-local" ? DATETIME_TEMPLATE : DATE_TEMPLATE;
  const [displayValue, setDisplayValue] = useState(() => isoToText(template, value));
  const [showCalendar, setShowCalendar] = useState(false);

  // valor de fora (carregou do banco, calendário, reset) → texto
  useEffect(() => {
    setDisplayValue((cur) => (textToIso(template, cur) === (value || null) ? cur : isoToText(template, value)));
  }, [value, template]);

  const withinMax = (iso: string) => !max || iso.slice(0, 10) <= max;

  // texto mudou → avisa o pai só com data completa e válida (ou vazio)
  const setText = (text: string) => {
    setDisplayValue(text);
    if (!text) {
      if (value) onChange({ target: { value: "" } });
      return;
    }
    const iso = textToIso(template, text);
    if (iso && withinMax(iso) && iso !== value) onChange({ target: { value: iso } });
  };

  const input = useOverwriteInput({ template, text: displayValue, setText, allowStep: true });
  const complete = displayValue.length === template.length;
  const invalid = complete && (!textToIso(template, displayValue) || !withinMax(textToIso(template, displayValue) || ""));

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
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");

    if (!withinMax(`${y}-${m}-${d}`)) return;
    if (type === "date") {
      onChange({ target: { value: `${y}-${m}-${d}` } });
    } else {
      const timePart = value && value.includes("T") ? value.split("T")[1].slice(0, 5) : "00:00";
      onChange({ target: { value: `${y}-${m}-${d}T${timePart}` } });
    }
    setShowCalendar(false);
  };

  return (
    <div className="relative w-full flex items-center">
      <BaseInput
        {...props}
        ref={input.ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={displayValue}
        onChange={input.onChange}
        onKeyDown={input.onKeyDown}
        onPaste={input.onPaste}
        placeholder={type === "date" ? "DD/MM/AAAA" : "DD/MM/AAAA HH:MM"}
        className={`${className} pr-10 ${invalid ? "!border-rose-500" : ""}`}
        maxLength={template.length}
        title={invalid ? "Data inválida" : "Selecione o dia, o mês ou o ano e digite só aquele pedaço · Setas ↑/↓ mudam o pedaço do cursor"}
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

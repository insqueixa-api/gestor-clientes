"use client";
// components/ui/FormattedTimeInput.tsx
// Input de hora mascarado em HH:MM (24h) — substitui <input type="time"> nativo,
// cujo formato de exibição (24h vs 12h AM/PM) depende do idioma do navegador.
// Suporta uso controlado (value/onChange) e não controlado (defaultValue/ref).

// ✅ 03/10/2026: digitação "sobrescreve no lugar" (components/ui/overwriteMask.ts)
// — selecionar só a hora ou só o minuto e digitar troca só aquele pedaço.
import React, { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { TIME_TEMPLATE } from "./overwriteMask";
import { useOverwriteInput } from "./useOverwriteInput";

type FormattedTimeInputProps = {
  value?: string;
  defaultValue?: string;
  onChange?: (e: { target: { value: string } }) => void;
  className?: string;
  [key: string]: any;
};

function maskDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length > 2) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return digits;
}

const FormattedTimeInput = forwardRef<HTMLInputElement, FormattedTimeInputProps>(
  function FormattedTimeInput({ value, defaultValue, onChange, className = "", ...props }, forwardedRef) {
    const isControlled = value !== undefined;
    const [display, setDisplay] = useState(maskDigits(value ?? defaultValue ?? ""));

    useEffect(() => {
      if (isControlled) setDisplay(maskDigits(value ?? ""));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const setText = (masked: string) => {
      setDisplay(masked);
      if (masked.length === 5) {
        const [hh, mm] = masked.split(":");
        if (Number(hh) > 23 || Number(mm) > 59) return;
      }
      onChange?.({ target: { value: masked } });
    };
    const input = useOverwriteInput({ template: TIME_TEMPLATE, text: display, setText });
    useImperativeHandle(forwardedRef, () => input.ref.current as HTMLInputElement);

    return (
      <input
        {...props}
        ref={input.ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        onChange={input.onChange}
        onKeyDown={input.onKeyDown}
        onPaste={input.onPaste}
        placeholder="HH:MM"
        maxLength={5}
        className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors ${className}`}
      />
    );
  },
);

export default FormattedTimeInput;

"use client";
// app/admin/FormattedTimeInput.tsx
// Input de hora mascarado em HH:MM (24h) — substitui <input type="time"> nativo,
// cujo formato de exibição (24h vs 12h AM/PM) depende do idioma do navegador.
// Suporta uso controlado (value/onChange) e não controlado (defaultValue/ref).

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

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
    const innerRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement);

    const isControlled = value !== undefined;
    const [display, setDisplay] = useState(maskDigits(value ?? defaultValue ?? ""));

    useEffect(() => {
      if (isControlled) setDisplay(maskDigits(value ?? ""));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const masked = maskDigits(e.target.value);
      setDisplay(masked);

      if (masked.length === 5) {
        const [hh, mm] = masked.split(":");
        if (Number(hh) > 23 || Number(mm) > 59) return;
      }

      onChange?.({ target: { value: masked } });
    };

    return (
      <input
        {...props}
        ref={innerRef}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        placeholder="HH:MM"
        maxLength={5}
        className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors ${className}`}
      />
    );
  },
);

export default FormattedTimeInput;

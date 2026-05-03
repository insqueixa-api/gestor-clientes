"use client";

import React, { createContext, useContext, useCallback, useState, ReactNode } from "react";
import ConfirmDialog, { ConfirmDialogProps } from "@/app/admin/ConfirmDialog";

type ConfirmOptions = Omit<
  ConfirmDialogProps,
  "open" | "onConfirm" | "onCancel" | "loading"
>;

type ConfirmContextType = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve);
    });
  }, []);

  const onCancel = useCallback(() => {
    setOpen(false);
    if (resolver) resolver(false);
    setResolver(null);
  }, [resolver]);

  const onConfirm = useCallback(() => {
    setOpen(false);
    if (resolver) resolver(true);
    setResolver(null);
  }, [resolver]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      
      {opts && (
        <ConfirmDialog
          open={open}
          title={opts.title}
          subtitle={opts.subtitle}
          details={opts.details}
          tone={opts.tone}
          icon={opts.icon}
          confirmText={opts.confirmText}
          cancelText={opts.cancelText}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm deve ser usado dentro de um ConfirmProvider");
  }
  
  // ✅ TRUQUE DE MESTRE: Retornamos ConfirmUI como null.
  // Assim, as páginas antigas que fazem `const { confirm, ConfirmUI } = useConfirm()`
  // NÃO VÃO QUEBRAR. Elas simplesmente vão renderizar null onde estava o {ConfirmUI}.
  return { confirm: context.confirm, ConfirmUI: null };
}
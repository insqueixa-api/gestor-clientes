"use client";
// hooks/usePrompt.tsx

import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  ReactNode,
} from "react";
import PromptDialog, { PromptDialogProps } from "@/components/ui/PromptDialog";

type PromptOptions = Omit<
  PromptDialogProps,
  "open" | "onConfirm" | "onCancel" | "loading"
>;

type PromptContextType = {
  prompt: (options: PromptOptions) => Promise<string | null>;
};

const PromptContext = createContext<PromptContextType | undefined>(undefined);

export function PromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<PromptOptions | null>(null);
  const [resolver, setResolver] = useState<
    ((v: string | null) => void) | null
  >(null);

  const prompt = useCallback((options: PromptOptions) => {
    setOpts(options);
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      setResolver(() => resolve);
    });
  }, []);

  const onCancel = useCallback(() => {
    setOpen(false);
    if (resolver) resolver(null);
    setResolver(null);
  }, [resolver]);

  const onConfirm = useCallback(
    (value: string) => {
      setOpen(false);
      if (resolver) resolver(value);
      setResolver(null);
    },
    [resolver],
  );

  return (
    <PromptContext.Provider value={{ prompt }}>
      {children}

      {opts && (
        <PromptDialog
          open={open}
          title={opts.title}
          subtitle={opts.subtitle}
          label={opts.label}
          placeholder={opts.placeholder}
          defaultValue={opts.defaultValue}
          tone={opts.tone}
          icon={opts.icon}
          confirmText={opts.confirmText}
          cancelText={opts.cancelText}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )}
    </PromptContext.Provider>
  );
}

export function usePrompt() {
  const context = useContext(PromptContext);
  if (!context) {
    throw new Error("usePrompt deve ser usado dentro de um PromptProvider");
  }
  return context;
}

"use client";

import React, { useCallback, useMemo, useState } from "react";
import ConfirmDialog, { ConfirmDialogProps } from "@/app/admin/ConfirmDialog";

type ConfirmOptions = Omit<
  ConfirmDialogProps,
  "open" | "onConfirm" | "onCancel" | "loading"
>;

export function useConfirm() {
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

  const ConfirmUI = useMemo(() => {
    if (!opts) return null;

    return (
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
    );
  }, [open, opts, onCancel, onConfirm]);

  return { confirm, ConfirmUI };
}

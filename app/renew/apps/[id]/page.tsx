// app/renew/apps/[id]/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import AppDetailClient from "./AppDetailClient";
import { ConfirmProvider } from "@/hooks/useConfirm";
import { PORTAL_APPS_DISABLED } from "@/lib/apps/portal-apps-flag";

export default function Page() {
  // ⏸️ Meus Aplicativos desligado durante o refactor (lib/apps/portal-apps-flag.ts)
  if (PORTAL_APPS_DISABLED) redirect("/renew");

  return (
    <ConfirmProvider>
      <Suspense fallback={<div />}>
        <AppDetailClient />
      </Suspense>
    </ConfirmProvider>
  );
}

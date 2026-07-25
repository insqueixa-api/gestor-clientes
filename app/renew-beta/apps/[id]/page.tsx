// app/renew-beta/apps/[id]/page.tsx
import { Suspense } from "react";
import AppDetailClient from "./AppDetailClient";
import { ConfirmProvider } from "@/hooks/useConfirm";

export default function Page() {
  return (
    <ConfirmProvider>
      <Suspense fallback={<div />}>
        <AppDetailClient />
      </Suspense>
    </ConfirmProvider>
  );
}

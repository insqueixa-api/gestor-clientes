// app/renew-beta/page.tsx
import { Suspense } from "react";
import RenewBetaClient from "./RenewBetaClient";
import { ConfirmProvider } from "@/hooks/useConfirm";

export default function Page() {
  return (
    <ConfirmProvider>
      <Suspense fallback={<div />}>
        <RenewBetaClient />
      </Suspense>
    </ConfirmProvider>
  );
}

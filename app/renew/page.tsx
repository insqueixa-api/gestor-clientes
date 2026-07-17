// app/renew/page.tsx
import { Suspense } from "react";
import RenewClient from "./RenewClient";
import { ConfirmProvider } from "@/app/admin/HookuseConfirm";

export default function Page() {
  return (
    <ConfirmProvider>
      <Suspense fallback={<div />}>
        <RenewClient />
      </Suspense>
    </ConfirmProvider>
  );
}

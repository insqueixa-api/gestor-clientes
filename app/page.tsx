import { Suspense } from "react";
import AreaDoClienteClient from "./renew/RenewClient";

export default function Page() {
  return (
    <Suspense fallback={<div />}>
      <AreaDoClienteClient />
    </Suspense>
  );
}

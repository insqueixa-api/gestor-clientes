import { Suspense } from "react";
import AreaDoClienteClient from "./AreaDoClienteClient";

export default function Page() {
  return (
    <Suspense fallback={<div />}>
      <AreaDoClienteClient />
    </Suspense>
  );
}

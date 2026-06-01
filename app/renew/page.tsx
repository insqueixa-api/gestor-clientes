import { Suspense } from "react";
import RenewClient from "./RenewClient";

export default function Page() {
  return (
    <Suspense fallback={<div />}>
      <RenewClient />
    </Suspense>
  );
}

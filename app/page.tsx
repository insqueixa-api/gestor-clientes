import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default function HomePage() {
  return (
    <Suspense fallback={<div />}>
      <LoginClient />
    </Suspense>
  );
}
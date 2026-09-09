// lib/apps/appativa-client-poll.ts
//
// Polling client-side da confirmação de ativação/renovação via Appativa —
// pedido do Márcio (09/09/2026): tanto no admin (Editar Cliente) quanto no
// "Log do Portal" (Auditoria → Concluir renovação), a espera deveria se
// comportar igual o Portal do cliente (RenewClient.tsx: aguarda sozinho,
// atualiza sozinho quando confirma) — sem precisar ficar clicando "Ver
// status" à mão. Compartilhado entre os dois lugares (app/admin/cliente/
// novo_cliente.tsx e components/apps/AppRequestModal.tsx) pra nunca
// dessincronizar a janela de espera entre eles de novo.
//
// ⚠️ Client-safe de propósito (sem imports de lib/integrations/appativa.ts,
// que puxa lib/notifications/notify.ts — código de servidor). Só constantes
// e um laço de polling genérico; cada caller decide o que checar/atualizar.
export const APPATIVA_CLIENT_POLL_INITIAL_DELAY_MS = 15_000;
export const APPATIVA_CLIENT_POLL_INTERVAL_MS = 5_000;
// ✅ ~2min (pedido explícito do Márcio) — mais longo que a janela do
// worker em segundo plano (lib/integrations/appativa.ts, ~75s), sem
// problema: cada tentativa aqui é uma nova consulta stateless na Appativa,
// não depende do worker do servidor ainda estar rodando.
export const APPATIVA_CLIENT_POLL_TOTAL_MS = 120_000;

export function runAppativaAutoPoll(opts: {
  // Faz UMA checagem e devolve o resultado. Quem chama já deve ter
  // atualizado toasts/estado/UI antes de devolver — o laço só decide se
  // continua ("pending") ou para ("done"/"error").
  checkOnce: () => Promise<"done" | "pending" | "error">;
  onTimeout: () => void;
  isCancelled: () => boolean;
}): void {
  const { checkOnce, onTimeout, isCancelled } = opts;
  const startedAt = Date.now();

  async function tick() {
    if (isCancelled()) return;
    if (Date.now() - startedAt >= APPATIVA_CLIENT_POLL_TOTAL_MS) {
      onTimeout();
      return;
    }
    let outcome: "done" | "pending" | "error" = "pending";
    try {
      outcome = await checkOnce();
    } catch {
      outcome = "pending"; // falha de rede passageira — tenta de novo no próximo tick
    }
    if (outcome !== "pending") return; // resolvido — quem chamou já tratou
    if (isCancelled()) return;
    setTimeout(tick, APPATIVA_CLIENT_POLL_INTERVAL_MS);
  }

  setTimeout(tick, APPATIVA_CLIENT_POLL_INITIAL_DELAY_MS);
}

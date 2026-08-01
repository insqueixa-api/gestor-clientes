// lib/observability.ts
// Ponto único pra sinalizar tentativa de acesso indevido pro Sentry — usado
// só nos pontos de rejeição por FALTA DE PERMISSÃO (403 / secret interno
// errado), nunca pra 401 comum (sessão expirada, sem token). 401 é ruído
// normal de tráfego (sessão vencida, bot batendo em qualquer rota) — logar
// isso no Sentry esgotaria a cota de eventos do plano gratuito rapidinho
// sem sinalizar nada acionável.
import * as Sentry from "@sentry/nextjs";

export function flagSuspiciousAccess(reason: string, context: Record<string, unknown> = {}) {
  Sentry.captureMessage(`acesso_negado: ${reason}`, {
    level: "warning",
    tags: { kind: "suspicious_access", reason },
    extra: context,
  });
}

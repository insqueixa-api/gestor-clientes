// lib/dom-focus.ts
// ✅ 03/10/2026 (pedido do Márcio): ao terminar de digitar o MAC, pula pro
// próximo campo (normalmente a Device Key) — sem precisar clicar.

/** MAC completo no formato AA:BB:CC:DD:EE:FF (17 caracteres). */
export const MAC_FULL_LENGTH = 17;

/**
 * Chame no onChange do campo de MAC: se o valor ACABOU de ficar completo
 * (antes não estava), leva o foco pro próximo campo de texto da tela.
 */
export function focusNextWhenMacComplete(el: HTMLElement | null, previous: string, next: string) {
  if (!el || next.length !== MAC_FULL_LENGTH || previous.length >= MAC_FULL_LENGTH) return;
  // depois do React aplicar o valor novo
  requestAnimationFrame(() => {
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]), textarea:not([disabled])',
      ),
    ).filter((i) => i.offsetParent !== null);
    const idx = inputs.indexOf(el as HTMLInputElement);
    const target = idx >= 0 ? inputs[idx + 1] : null;
    if (target) {
      target.focus();
      target.select?.();
    }
  });
}

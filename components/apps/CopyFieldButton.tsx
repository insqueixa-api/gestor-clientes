"use client";
// components/apps/CopyFieldButton.tsx
// Botão de copiar de um campo de app — mesmo ícone/comportamento usado no
// card de aplicativos (novo_cliente.tsx) e no AppRequestModal (log de
// pedidos da Auditoria), pra não ter dois "botões de copiar" com aparência
// diferente pelo sistema.
export default function CopyFieldButton({
  value,
  label,
  onCopy,
  className = "",
}: {
  value: string;
  label: string;
  onCopy: (label: string, value: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCopy(label, value);
      }}
      className={className || "p-1.5 text-muted-foreground hover:text-sky-500 transition-colors"}
      title="Copiar conteúdo"
      tabIndex={-1}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
  );
}

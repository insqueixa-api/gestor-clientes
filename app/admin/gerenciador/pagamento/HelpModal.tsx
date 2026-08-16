"use client";
// app/admin/gerenciador/pagamento/HelpModal.tsx
import { GATEWAY_HELP, IconX, renderStepWithLinks } from "./shared";

export default function HelpModal({ type, onClose }: { type: string; onClose: () => void }) {
  const help = GATEWAY_HELP[type];
  if (!help) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] bg-card border border-border rounded-xl shadow-2xl flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-transparent rounded-t-xl flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium text-foreground">
              📖 {help.title}
            </h2>
            <a
              href={help.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-500 font-medium hover:underline mt-0.5 inline-block"
            >
              {help.linkLabel}
            </a>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <IconX />
          </button>
        </div>

        {/* Steps */}
        <div className="flex-1 min-h-0 p-5 overflow-y-auto space-y-4">
          <ol className="space-y-3">
            {help.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-500/10 text-emerald-500 text-xs font-medium flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm text-foreground/80 leading-relaxed">
                  {renderStepWithLinks(step)}
                </span>
              </li>
            ))}
          </ol>

          {help.warnings && help.warnings.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border">
              {help.warnings.map((w, i) => (
                <p
                  key={i}
                  className="text-xs font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2"
                >
                  {w}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border bg-transparent sm:rounded-b-xl">
          <button
            onClick={onClose}
            className="w-full h-9 rounded-lg bg-transparent text-foreground/90 font-medium text-sm hover:bg-muted transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

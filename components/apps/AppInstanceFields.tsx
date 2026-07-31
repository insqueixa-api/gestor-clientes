"use client";
// components/apps/AppInstanceFields.tsx
//
// Grade de campos de uma instância de app (MAC/Device Key/Vencimento/
// Ambiente/E-mail/Senha etc, o que o catálogo desse app tiver) — editável,
// com botão de copiar, sem máscara de senha. Único, usado tanto pelo card de
// aplicativos em app/admin/cliente/novo_cliente.tsx quanto pelo
// components/apps/AppRequestModal.tsx (log de pedidos e pagamentos da
// Auditoria) — antes um editava de verdade e o outro só exibia texto fixo,
// então não dava pra corrigir nada (nem um MAC errado, nem limpar um campo)
// por ali. Agora os dois editam e persistem do mesmo jeito.
import FormattedDateInput from "@/components/ui/FormattedDateInput";
import CopyFieldButton from "@/components/apps/CopyFieldButton";
import { APP_FIELD_LABELS, normalizeMacInput } from "@/lib/apps/field-types";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
      {children}
    </label>
  );
}

function BaseInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

export default function AppInstanceFields({
  fieldsConfig,
  values,
  onFieldChange,
  onCopy,
}: {
  fieldsConfig: any[] | null | undefined;
  values: Record<string, any> | null | undefined;
  onFieldChange: (key: string, value: string) => void;
  onCopy: (label: string, value: string) => void;
}) {
  if (!fieldsConfig || fieldsConfig.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground italic col-span-2 py-1">
        Este aplicativo não requer configuração adicional.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {fieldsConfig.map((field: any, index: number) => {
        const fieldKey = String(field?.id ?? field?.label ?? "").trim();
        const rawLabel = String(field?.label ?? "").trim();
        const label = APP_FIELD_LABELS[String(field?.type ?? "")] || rawLabel || "Campo";
        const isMacField = String(field?.type || "").toUpperCase() === "MAC";
        const isDateField = field?.type === "date";
        const safeKey = fieldKey || rawLabel || `field-${index}`;

        const fieldValue =
          (fieldKey && (values as any)?.[fieldKey] != null ? String((values as any)[fieldKey]) : "") ||
          (label && (values as any)?.[label] != null ? String((values as any)[label]) : "") ||
          "";

        const handleChange = (raw: string) => {
          const next = isMacField ? normalizeMacInput(raw) : raw;
          const key = String(fieldKey || label || "").trim();
          if (!key) return;
          onFieldChange(key, next);
        };

        return (
          <div key={safeKey}>
            <Label>{label}</Label>
            <div className="relative">
              {isDateField ? (
                <FormattedDateInput
                  type="date"
                  value={fieldValue}
                  onChange={(e: any) => handleChange(e.target.value)}
                  className="dark:[color-scheme:dark]"
                />
              ) : (
                <BaseInput
                  type="text"
                  value={fieldValue}
                  onChange={(e) => handleChange(e.target.value)}
                  placeholder={label ? `Digite ${label}...` : "Digite..."}
                  autoCapitalize={isMacField ? "characters" : "none"}
                  spellCheck={false}
                  className={fieldValue ? "pr-10" : ""}
                />
              )}

              {!isDateField && fieldValue && (
                <CopyFieldButton
                  value={fieldValue}
                  label={label}
                  onCopy={onCopy}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-sky-500 transition-colors"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

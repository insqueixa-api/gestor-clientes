"use client";
// app/admin/gerenciador/cobranca/AutomationWizard.tsx
// Extraído de page.tsx (15/08/2026) — wizard de criar/editar automação, o
// mais pesado dos 3 modais, carrega via next/dynamic só quando abre.
import { useState, useRef, useEffect } from "react";
import { CheckCircle2, SlidersHorizontal, X, Send, Clock3 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { Dropdown } from "@/components/ui/Dropdown";
import { Label, Input, TYPES } from "./shared";

const CLIENT_STATUS = [
  { id: "ACTIVE", label: "Ativo" },
  { id: "OVERDUE", label: "Vencido" },
  { id: "TRIAL", label: "Teste" },
  { id: "ARCHIVED", label: "Arquivado" },
];

export default function AutomationWizard({
  auxData,
  editingRule,
  onClose,
  onSuccess,
  onError,
}: {
  auxData: any;
  editingRule?: any;
  onClose: () => void;
  onSuccess: () => void;
  onError: (m: string) => void;
}) {
  const tenantId = useTenantId();
  const steps = [
    {
      id: 1,
      title: "Base da regra",
      caption: "Tipo, mensagem e sessão.",
      icon: CheckCircle2,
    },
    {
      id: 2,
      title: "Público e envio",
      caption: "Filtros e modo da regra.",
      icon: SlidersHorizontal,
    },
  ] as const;
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    type: "Vencimento",
    message_template_id: "",
    whatsapp_session: "default",
    is_active: true,
    status: ["ACTIVE"],
    servers: [] as string[],
    plans: [] as string[],
    apps: [] as string[],
    rule_date_field: "vencimento",
    rule_days_diff: -3,
    is_automatic: true,
  });

  useEffect(() => {
    if (editingRule) {
      setForm({
        name: editingRule.name,
        type: editingRule.type,
        message_template_id:
          editingRule.message_template_id ||
          editingRule.message_template?.id ||
          "",
        whatsapp_session: editingRule.whatsapp_session || "default",
        is_active: editingRule.is_active,
        is_automatic: editingRule.is_automatic,
        status: editingRule.target_status || [],
        servers: editingRule.target_servers || [],
        plans: editingRule.target_plans || [],
        apps: editingRule.target_apps || [],
        rule_date_field:
          (editingRule.rule_date_field === "cadastro"
            ? "created_at"
            : editingRule.rule_date_field) || "vencimento",
        rule_days_diff: editingRule.rule_days_diff,
      });
    }
  }, [editingRule]);

  const handleSave = async () => {
    if (!form.name) {
      setStep(1);
      setTimeout(() => onError("Preencha o Nome da Automação."), 200);
      return;
    }

    setSaving(true);
    try {
      const tid = tenantId;
      if (!tid) throw new Error("Sessão inválida.");

      {
        const { data: u } = await supabaseBrowser.auth.getUser();
        const userId = u?.user?.id;
        if (!userId) throw new Error("Sessão inválida.");

        const { data: mem, error: memErr } = await supabaseBrowser
          .from("tenant_members")
          .select("tenant_id")
          .eq("tenant_id", tid)
          .eq("user_id", userId)
          .maybeSingle();

        if (memErr || !mem) throw new Error("Forbidden");
      }

      const payload = {
        tenant_id: tid,
        name: form.name,
        type: form.type,
        is_active: form.message_template_id ? form.is_active : false,
        is_automatic: form.is_automatic,
        message_template_id: form.message_template_id,
        whatsapp_session: form.whatsapp_session,
        delay_min: 20,
        target_status: form.status,
        target_servers: form.servers,
        target_plans: form.plans,
        target_apps: form.apps,
        rule_date_field:
          form.rule_date_field === "cadastro"
            ? "created_at"
            : form.rule_date_field,
        rule_days_diff: form.rule_days_diff,
      };

      let error;
      if (editingRule?.id) {
        const { error: updErr } = await supabaseBrowser
          .from("billing_automations")
          .update(payload)
          .eq("id", editingRule.id)
          .eq("tenant_id", tid);
        error = updErr;
      } else {
        const { error: insErr } = await supabaseBrowser
          .from("billing_automations")
          .insert(payload);
        error = insErr;
      }

      if (error) throw error;
      onSuccess();
    } catch (e: any) {
      onError(e.message || "Erro ao salvar no banco.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <div className="px-2.5 py-2 border-b border-border bg-card/95 backdrop-blur">
          <div className="flex justify-between items-start gap-2 mb-1.5">
            <div>
              <h2 className="text-lg font-medium text-foreground">
                {editingRule
                  ? `Editar: ${editingRule.name}`
                  : "Nova automação de cobrança"}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {steps.map((item) => {
              const Icon = item.icon;
              const active = item.id === step;
              const done = item.id < step;
              return (
                <button
                  key={item.id}
                  onClick={() => setStep(item.id)}
                  className={`rounded-lg border px-2 py-1 text-left transition-all ${active ? "border-emerald-500/30 bg-emerald-500/10 shadow-sm" : done ? "border-border bg-muted/40" : "border-border bg-background"}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border ${active ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-border bg-background text-muted-foreground"}`}
                    >
                      <Icon className="h-3 w-3" />
                    </span>
                    <div>
                      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Etapa {item.id}
                      </div>
                      <div className="text-xs font-medium text-foreground">
                        {item.title}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <ModalBody className="p-2 sm:p-2.5 bg-muted/10">
          {step === 1 && (
            <div className="space-y-1.5">
              <div className="rounded-xl border border-border bg-card p-2 space-y-2 shadow-sm">
                <div>
                  <h3 className="text-[13px] font-medium text-foreground">
                    Definição principal
                  </h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Tipo da régua, template e sessão.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <div>
                    <Label>Tipo</Label>
                    <Select
                      value={form.type}
                      onChange={(e) =>
                        setForm({ ...form, type: e.target.value })
                      }
                    >
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label>Nome da automação</Label>
                    <Input
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      placeholder="Ex.: Vencido há 3 dias"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div>
                    <Label>Mensagem</Label>
                    <Select
                      value={form.message_template_id}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          message_template_id: e.target.value,
                        })
                      }
                    >
                      <option value="">Selecione...</option>
                      {auxData.templates
                        .filter((t: any) => {
                          if (String(t.label).toLowerCase().startsWith("teste"))
                            return false;
                          return true;
                        })
                        .map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                    </Select>
                  </div>
                  <div>
                    <Label>Sessão WhatsApp</Label>
                    <Select
                      value={form.whatsapp_session}
                      onChange={(e) =>
                        setForm({ ...form, whatsapp_session: e.target.value })
                      }
                    >
                      {(auxData.sessions?.length
                        ? auxData.sessions
                        : [{ id: "default", label: "Principal" }]
                      ).map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-2 shadow-sm">
                <Label>Regra de Disparo</Label>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/20 p-2">
                  <span className="text-sm font-medium text-foreground/80">
                    Enviar
                  </span>
                  <div className="inline-flex items-center overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <button
                      onClick={() =>
                        setForm({
                          ...form,
                          rule_days_diff: -Math.abs(form.rule_days_diff || 1),
                        })
                      }
                      className={`h-7.5 px-2.5 text-xs font-medium transition-colors ${form.rule_days_diff < 0 ? "bg-rose-500/10 text-rose-500" : "text-muted-foreground hover:bg-muted/80"}`}
                    >
                      Antes
                    </button>
                    <button
                      onClick={() => setForm({ ...form, rule_days_diff: 0 })}
                      className={`h-7.5 px-2.5 border-x border-border text-xs font-medium transition-colors ${form.rule_days_diff === 0 ? "bg-sky-500/10 text-sky-500" : "text-muted-foreground hover:bg-muted/80"}`}
                    >
                      No Dia
                    </button>
                    <button
                      onClick={() =>
                        setForm({
                          ...form,
                          rule_days_diff: Math.abs(form.rule_days_diff || 1),
                        })
                      }
                      className={`h-7.5 px-2.5 text-xs font-medium transition-colors ${form.rule_days_diff > 0 ? "bg-emerald-500/10 text-emerald-500" : "text-muted-foreground hover:bg-muted/80"}`}
                    >
                      Depois
                    </button>
                  </div>
                  {form.rule_days_diff !== 0 && (
                    <input
                      type="number"
                      className="h-8 w-14 rounded-lg border border-border bg-transparent text-center text-sm font-medium outline-none transition-colors focus:border-emerald-500/50"
                      value={Math.abs(form.rule_days_diff)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          rule_days_diff:
                            Number(e.target.value) *
                            (form.rule_days_diff < 0 ? -1 : 1),
                        })
                      }
                    />
                  )}
                  <span className="text-sm font-medium text-foreground/80">
                    {form.rule_days_diff !== 0 ? "dias do" : "do"}
                  </span>
                  <select
                    className="h-8 rounded-lg border border-border bg-transparent px-2 text-sm font-medium outline-none transition-colors focus:border-emerald-500/50"
                    value={form.rule_date_field}
                    onChange={(e) =>
                      setForm({ ...form, rule_date_field: e.target.value })
                    }
                  >
                    <option value="vencimento">Vencimento</option>
                    <option value="created_at">Cadastro</option>
                  </select>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Exemplo: "3 dias após vencimento" ou "no dia do cadastro".
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-1.5">
              <div className="rounded-xl border border-border bg-card p-2 shadow-sm space-y-2">
                <div>
                  <h3 className="text-[13px] font-medium text-foreground">
                    Quem recebe?
                  </h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Deixe sem filtro quando a regra precisar atingir toda a base
                    daquele tipo.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <MultiSelectDropdown
                    label="Status do Cliente"
                    options={CLIENT_STATUS}
                    selected={form.status}
                    onChange={(v: any) => setForm({ ...form, status: v })}
                  />
                  <MultiSelectDropdown
                    label="Servidores"
                    options={auxData.servers}
                    selected={form.servers}
                    onChange={(v: any) => setForm({ ...form, servers: v })}
                  />
                  <MultiSelectDropdown
                    label="Planos"
                    options={auxData.plans}
                    selected={form.plans}
                    onChange={(v: any) => setForm({ ...form, plans: v })}
                  />
                  <MultiSelectDropdown
                    label="Aplicativos"
                    options={auxData.apps}
                    selected={form.apps}
                    onChange={(v: any) => setForm({ ...form, apps: v })}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-2 shadow-sm space-y-2">
                <div>
                  <h3 className="text-[13px] font-medium text-foreground">
                    Modo de envio
                  </h3>
                </div>
                <div className="flex items-center justify-between gap-1.5 rounded-lg border border-border/70 bg-muted/10 p-1">
                  <span className="px-1 text-[10px] font-medium text-muted-foreground">
                    Operação
                  </span>
                  <div className="inline-flex items-center gap-0.5 rounded-md border border-border/80 bg-transparent p-0.5">
                    <button
                      onClick={() => setForm({ ...form, is_automatic: false })}
                      className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${!form.is_automatic ? "bg-card text-foreground border border-border" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Manual
                    </button>
                    <button
                      onClick={() => setForm({ ...form, is_automatic: true })}
                      className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${form.is_automatic ? "bg-card text-emerald-600 border border-emerald-500/30" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Automático
                    </button>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-transparent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {form.is_automatic ? (
                      <Clock3 className="h-3 w-3" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    {form.is_automatic ? "Auto" : "Manual"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </ModalBody>

        <ModalFooter className="flex justify-between items-center">
          {step === 1 && (
            <>
              <button
                onClick={onClose}
                className="px-2.5 py-1 rounded-lg border border-border text-[11px] font-medium text-muted-foreground hover:bg-muted uppercase transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => setStep(2)}
                className="px-3.5 py-1 bg-emerald-600 text-white hover:bg-emerald-500 font-medium rounded-lg shadow-lg shadow-emerald-900/20 transition-all text-[11px] uppercase"
              >
                Próximo: Público →
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button
                onClick={() => setStep(1)}
                className="px-2.5 py-1 rounded-lg border border-border text-[11px] font-medium text-muted-foreground hover:bg-muted uppercase transition-colors"
              >
                ← Voltar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3.5 py-1 bg-emerald-600 text-white hover:bg-emerald-500 font-medium rounded-lg shadow-lg shadow-emerald-900/20 transition-all text-[11px] uppercase"
              >
                {saving
                  ? "Salvando..."
                  : editingRule
                    ? "Salvar alterações"
                    : "Confirmar e Criar"}
              </button>
            </>
          )}
        </ModalFooter>
    </Modal>
  );
}

function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-8 px-2.5 bg-card border border-border rounded-lg text-xs text-foreground outline-none focus:border-emerald-500 transition-colors ${className}`}
    >
      {children}
    </select>
  );
}

// ✅ MULTI-SELECT DROPDOWN SIMPLIFICADO E BLINDADO
function MultiSelectDropdown({ label, options, selected, onChange }: any) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<any>(null); // ✅ any para evitar erro de tipo

  const toggleOption = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x: any) => x !== id));
    else onChange([...selected, id]);
  };

  const getLabel = () => {
    if (selected.length === 0) return "Todos (Sem filtro)";
    if (selected.length === 1)
      return (
        options.find((o: any) => o.id === selected[0])?.label || selected[0]
      );
    return `${selected.length} selecionados`;
  };

  return (
    <div className="relative" ref={containerRef}>
      <Label>{label}</Label>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full h-8 px-2 text-left rounded-lg border text-[11px] flex justify-between items-center transition-all ${open ? "border-emerald-500 ring-1 ring-emerald-500/20 bg-card" : "border-border bg-card text-foreground/90"}`}
      >
        <span
          className={
            selected.length === 0
              ? "text-muted-foreground italic"
              : "font-medium"
          }
        >
          {getLabel()}
        </span>
        <span className="text-xs text-muted-foreground">▼</span>
      </button>

      <Dropdown
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={containerRef}
        align="left"
        placement="above"
        matchTriggerWidth
        className="flex flex-col"
      >
          <div className="max-h-40 overflow-y-auto custom-scrollbar p-1">
            {options.map((opt: any) => (
              <div
                key={opt.id}
                onClick={() => toggleOption(opt.id)}
                className="px-2 py-1 hover:bg-muted cursor-pointer flex items-center gap-2 transition-colors rounded-lg"
              >
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selected.includes(opt.id) ? "bg-emerald-500 border-emerald-500" : "border-border"}`}
                >
                  {selected.includes(opt.id) && (
                    <span className="text-[10px] text-white">✓</span>
                  )}
                </div>
                <span className="text-[11px] text-foreground/90">
                  {opt.label}
                </span>
              </div>
            ))}
          </div>
          {/* ✅ BOTÃO CONCLUIR */}
          <div className="p-2 border-t border-border bg-transparent">
            <button
              onClick={() => setOpen(false)}
              className="w-full py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-medium text-xs uppercase transition-colors"
            >
              Concluir
            </button>
          </div>
      </Dropdown>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {selected.map((id: string) => {
            const label = options.find((o: any) => o.id === id)?.label || id;
            return (
              <span
                key={id}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-transparent border border-border text-[10px] font-medium text-muted-foreground"
              >
                {label}
                <button
                  onClick={() => toggleOption(id)}
                  className="ml-1 text-muted-foreground hover:text-rose-500 text-[9px]"
                >
                  ✕
                </button>
              </span>
            );
          })}
          <button
            onClick={() => onChange([])}
            className="text-[9px] text-rose-500 hover:underline underline-offset-2 ml-1"
          >
            Limpar
          </button>
        </div>
      )}
    </div>
  );
}

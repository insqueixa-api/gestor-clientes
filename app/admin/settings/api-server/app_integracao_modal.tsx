"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/app/admin/HookuseConfirm";

function normalizeApiUrl(url: string) {
  if (!url) return "";
  let s = url.trim().replace(/\/+$/, "");
  if (s && !s.startsWith("http")) s = "https://" + s;
  return s;
}

type AppIntegration = {
  id: string;
  tenant_id: string;
  app_name: string;
  label: string;
  login_email: string | null;
  login_password: string | null;
  api_url: string | null;
  is_active: boolean;
  created_at: string;
};

// Config por app: placeholders e quais campos mostrar
const APP_CONFIG: Record<string, {
  urlPlaceholder: string;
  showEmail: boolean;
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  onlyNumbers?: boolean;
  maxLength?: number;
}> = {
  GERENCIAAPP: {
    urlPlaceholder: "https://gerenciaapp.top",
    showEmail: true,
    emailLabel: "E-mail de login",
    emailPlaceholder: "seuemail@gerenciaapp.top",
    passwordLabel: "Senha",
    passwordPlaceholder: "Sua senha do painel",
  },
  DUPLECAST: {
    urlPlaceholder: "https://duplecast.com/client/login",
    showEmail: true,
    emailLabel: "Usuário / E-mail",
    emailPlaceholder: "Seu usuário no DupleCast",
    passwordLabel: "Senha / PIN",
    passwordPlaceholder: "Senha ou PIN numérico",
  },
  ZONEX: {
    urlPlaceholder: "https://painel.zonex.tv",
    showEmail: true,
    emailLabel: "E-mail de login",
    emailPlaceholder: "seuemail@exemplo.com",
    passwordLabel: "Senha",
    passwordPlaceholder: "Sua senha do painel",
  },
};

function getConfig(appName: string) {
  return APP_CONFIG[appName] ?? {
    urlPlaceholder: "https://painel.seuapp.com",
    showEmail: true,
    emailLabel: "E-mail de login",
    emailPlaceholder: "seuemail@exemplo.com",
    passwordLabel: "Senha",
    passwordPlaceholder: "Senha do painel",
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">
      {children}
    </label>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-0">{children}</div>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
    />
  );
}

export default function AppIntegracaoModal({
  integration,
  onCloseAction,
  onSuccessAction,
  onErrorAction,
}: {
  integration?: AppIntegration | null;
  onCloseAction: () => void;
  onSuccessAction: () => void;
  onErrorAction: (msg: string) => void;
}) {
  const isEdit = !!integration?.id;

  const [appName, setAppName]             = useState(integration?.app_name ?? "GERENCIAAPP");
  const [label, setLabel]                 = useState(integration?.label ?? "");
  const [loginEmail, setLoginEmail]       = useState(integration?.login_email ?? "");
  const [loginPassword, setLoginPassword] = useState(integration?.login_password ?? "");
  const [apiUrl, setApiUrl]               = useState(integration?.api_url ?? "");
  const [isActive, setIsActive]           = useState(integration?.is_active ?? true);
  const [saving, setSaving]               = useState(false);
  const [userEmail, setUserEmail]         = useState("");
  const [isUploading, setIsUploading]     = useState(false);

  const { confirm, ConfirmUI } = useConfirm();

  const cfg = getConfig(appName);

  useEffect(() => {
    if (integration) {
      setAppName(integration.app_name ?? "GERENCIAAPP");
      setLabel(integration.label ?? "");
      setLoginEmail(integration.login_email ?? "");
      setLoginPassword(integration.login_password ?? "");
      setApiUrl(integration.api_url ?? "");
      setIsActive(integration.is_active ?? true);
    }
    supabaseBrowser.auth.getUser().then(({ data }) => {
      if (data?.user?.email) setUserEmail(data.user.email);
    });
  }, [integration]);

  const canSave = label.trim() && loginPassword.trim() && apiUrl.trim() &&
    (cfg.showEmail ? loginEmail.trim() : true);

  const isMasterUser = userEmail === "insqueixa@gmail.com" || userEmail === "m.martins@sap.com";

  const downloadUrl = supabaseBrowser.storage
    .from("extensions")
    .getPublicUrl("unigestor-extensao.zip").data.publicUrl;

  async function handleUploadExtension(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ok = await confirm({
      title: "Atualizar Extensão?",
      subtitle: `Deseja fazer o upload do arquivo "${file.name}"? Isso substituirá a versão atual para toda a rede.`,
      confirmText: "Sim, Atualizar",
      cancelText: "Cancelar",
    });

    if (!ok) { e.target.value = ""; return; }

    try {
      setIsUploading(true);
      const { error } = await supabaseBrowser.storage
        .from("extensions")
        .upload("unigestor-extensao.zip", file, { upsert: true, cacheControl: "3600" });
      if (error) throw error;
      onSuccessAction();
    } catch (err: any) {
      onErrorAction(err.message || "Erro ao fazer upload.");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  }

  async function handleSave() {
    if (!canSave) return;
    try {
      setSaving(true);
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("Tenant não encontrado.");

      const payload = {
        tenant_id:      tenantId,
        app_name:       appName,
        label:          label.trim(),
        login_email:    loginEmail.trim() || null,
        login_password: loginPassword.trim(),
        api_url:        normalizeApiUrl(apiUrl),
        is_active:      isActive,
      };

      if (isEdit) {
        const { error } = await supabaseBrowser
          .from("app_integrations")
          .update(payload)
          .eq("id", integration!.id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
      } else {
        const { error } = await supabaseBrowser
          .from("app_integrations")
          .insert(payload);
        if (error) throw error;
      }

      onSuccessAction();
    } catch (e: any) {
      onErrorAction(e?.message ?? "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center px-3">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCloseAction} />

      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] shadow-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">

        {/* HEADER */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 rounded-t-2xl flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-white">
              {isEdit ? "Editar Integração" : "Nova Integração"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-white/40 mt-0.5">
              Credenciais para automação via extensão Chrome
            </p>
          </div>
          <button
            onClick={onCloseAction}
            type="button"
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 dark:text-white/40 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* BODY */}
        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">

          {/* Extensão: download + upload (master) */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-500/20 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-sky-600 dark:text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-700 dark:text-white">Extensão do Chrome</div>
                <div className="text-[10px] text-slate-400 dark:text-white/40">Necessária para automação</div>
              </div>
            </div>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold transition-colors flex items-center gap-1.5 shrink-0"
            >
              Baixar .zip
            </a>
          </div>

          {/* Upload — só master */}
          {isMasterUser && (
            <div className="p-3 rounded-xl border border-dashed border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-white/5">
              <div className="text-[9px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mb-2">
                Área do Desenvolvedor
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleUploadExtension}
                  disabled={isUploading}
                  className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-[10px] file:font-bold file:bg-slate-200 file:text-slate-700 hover:file:bg-slate-300 dark:file:bg-white/10 dark:file:text-white cursor-pointer text-slate-500 dark:text-white/40"
                />
                {isUploading && (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 animate-pulse">
                    Enviando...
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-slate-100 dark:border-white/5" />

          {/* Aplicativo */}
          <Field>
            <Label>Aplicativo</Label>
            <select
              value={appName}
              onChange={(e) => {
                setAppName(e.target.value);
                setLoginEmail("");
                setLoginPassword("");
                setApiUrl("");
              }}
              className="w-full h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
            >
              <option value="GERENCIAAPP">GerenciaApp</option>
              <option value="DUPLECAST">DupleCast</option>
              <option value="ZONEX">ZoneX</option>
            </select>
          </Field>

          {/* Nome */}
          <Field>
            <Label>Nome da integração</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder='Ex: "Meu Painel Principal"'
            />
          </Field>

          {/* URL do painel */}
          <Field>
            <Label>URL do painel</Label>
            <Input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder={cfg.urlPlaceholder}
              type="url"
            />
          </Field>

          {/* Email / usuário */}
          {cfg.showEmail && (
            <Field>
              <Label>{cfg.emailLabel}</Label>
              <Input
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder={cfg.emailPlaceholder}
                type="text"
                autoComplete="off"
              />
            </Field>
          )}

          {/* Senha / PIN */}
          <Field>
            <Label>{cfg.passwordLabel}</Label>
            <Input
              value={loginPassword}
              onChange={(e) => {
                const v = e.target.value;
                setLoginPassword(cfg.onlyNumbers ? v.replace(/\D/g, "") : v);
              }}
              placeholder={cfg.passwordPlaceholder}
              type="text"
              maxLength={cfg.maxLength}
              autoComplete="off"
            />
          </Field>

          {/* Status */}
          <div
            onClick={() => setIsActive((v) => !v)}
            className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
              isActive
                ? "border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10"
                : "border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5"
            }`}
          >
            <div>
              <div className={`text-xs font-bold ${isActive ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500 dark:text-white/50"}`}>
                {isActive ? "Integração ativa" : "Integração inativa"}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-white/30">
                {isActive ? "Será usada nas automações" : "Não será usada nas automações"}
              </div>
            </div>
            {/* Toggle visual */}
            <div className={`relative w-10 h-6 rounded-full transition-colors ${isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"}`}>
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isActive ? "left-5" : "left-1"}`} />
            </div>
          </div>

        </div>

        {/* FOOTER */}
        <div className="px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 rounded-b-2xl flex items-center justify-end gap-2 shrink-0">
          <button
            onClick={onCloseAction}
            type="button"
            disabled={saving}
            className="h-9 px-4 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-xs font-bold hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            type="button"
            disabled={!canSave || saving}
            className={`h-9 px-5 rounded-lg text-xs font-bold text-white transition-all ${
              canSave && !saving
                ? "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/20"
                : "bg-slate-300 dark:bg-white/10 cursor-not-allowed opacity-60"
            }`}
          >
            {saving ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar integração"}
          </button>
        </div>

      </div>

      {ConfirmUI}
    </div>
  );

  return createPortal(modal, document.body);
}

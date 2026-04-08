"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/app/admin/HookuseConfirm"; // 👈 NOVO

// ✅ NOVO: Helper para limpar e normalizar a URL do painel
function normalizeApiUrl(url: string) {
  if (!url) return "";
  let s = url.trim().replace(/\/+$/, ""); // Remove barras duplas no final
  if (s && !s.startsWith("http")) {
    s = "https://" + s; // Força ter o protocolo
  }
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

  const [appName, setAppName]         = useState(integration?.app_name ?? "GERENCIAAPP");
  const [label, setLabel]             = useState(integration?.label ?? "");
  const [loginEmail, setLoginEmail]   = useState(integration?.login_email ?? "");
  const [loginPassword, setLoginPassword] = useState(integration?.login_password ?? "");
  const [apiUrl, setApiUrl]           = useState(integration?.api_url ?? ""); // ✅ NOVO: Estado da URL
  const [isActive, setIsActive]       = useState(integration?.is_active ?? true);
  const [saving, setSaving]           = useState(false);
  const [userEmail, setUserEmail]     = useState("");
  
 // Controle de Upload da extensão
  const [isUploading, setIsUploading] = useState(false);
  const [showDocs, setShowDocs] = useState(false); // 👈 Controle do passo a passo minimizado
  const { confirm, ConfirmUI } = useConfirm(); 

  useEffect(() => {
    if (integration) {
      setAppName(integration.app_name ?? "GERENCIAAPP");
      setLabel(integration.label ?? "");
      setLoginEmail(integration.login_email ?? "");
      setLoginPassword(integration.login_password ?? "");
      setApiUrl(integration.api_url ?? ""); // ✅ NOVO: Carrega a URL na edição
      setIsActive(integration.is_active ?? true);
    }
    
    // Busca o usuário logado para controle de permissões (Master)
    supabaseBrowser.auth.getUser().then(({ data }) => {
        if (data?.user?.email) setUserEmail(data.user.email);
    });
  }, [integration]);

  // ✅ NOVO: Validação dinâmica. Se for DupleCast, não exige o E-mail.
  const canSave = appName === "DUPLECAST" 
    ? label.trim() && loginPassword.trim() && apiUrl.trim()
    : label.trim() && loginEmail.trim() && loginPassword.trim() && apiUrl.trim();
  
  // Define quem é o Master (você) para ver o botão de Upload
  const isMasterUser = userEmail === "insqueixa@gmail.com" || userEmail === "m.martins@sap.com";

  // Gera o link público de download automaticamente
  const downloadUrl = supabaseBrowser.storage.from("extensions").getPublicUrl("unigestor-extensao.zip").data.publicUrl;

  async function handleUploadExtension(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // 👈 NOVA CAIXA DE CONFIRMAÇÃO
    const ok = await confirm({
      title: "Atualizar Extensão?",
      subtitle: `Deseja fazer o upload do arquivo "${file.name}"? Isso substituirá a versão atual para toda a rede.`,
      confirmText: "Sim, Atualizar",
      cancelText: "Cancelar"
    });

    if (!ok) {
      e.target.value = ""; 
      return;
    }

    try {
      setIsUploading(true);
      const { error } = await supabaseBrowser.storage
        .from("extensions")
        .upload("unigestor-extensao.zip", file, { upsert: true, cacheControl: "3600" });

      if (error) throw error;
      // 👈 Em vez de alert(), chamamos o onSuccessAction com uma mensagem customizada ou usamos o Toast da página pai
      onSuccessAction(); 
    } catch (err: any) {
      onErrorAction(err.message || "Erro ao fazer upload da extensão.");
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
        login_email:    loginEmail.trim(),
        login_password: loginPassword.trim(),
        api_url:        normalizeApiUrl(apiUrl), // ✅ NOVO: Envia a URL padronizada
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCloseAction} />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] shadow-xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              {isEdit ? "Editar Integração" : "Nova Integração de Aplicativo"}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-white/50 mt-1">
              Credenciais usadas para automação no painel do aplicativo.
            </p>
          </div>
          <button
            onClick={onCloseAction}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
            type="button"
          >
            Fechar
          </button>
        </div>

        {/* Body (Com scroll se a ecrã for pequena) */}
        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
            
          {/* Instruções e Download da Extensão (Visível para TODOS) */}
          <div className="p-4 bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 rounded-xl space-y-3">
              <h3 className="text-xs font-bold text-sky-800 dark:text-sky-300 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Como funciona a integração?
              </h3>
              <p className="text-[11px] text-sky-700 dark:text-sky-200/80 leading-relaxed">
                  Para garantir a segurança e evitar bloqueios, esta integração utiliza a <strong>Extensão Oficial do UniGestor</strong> para Google Chrome. Certifique-se de que a extensão está instalada no seu navegador e que o painel do aplicativo se encontra com sessão iniciada (logado) numa outra aba.
              </p>
              
              {/* Botão de Download liberado para a rede inteira */}
              <div className="pt-1">
                  <a
                      href={downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold rounded-lg transition-colors shadow-sm"
                  >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Baixar Extensão do Chrome (.zip)
                  </a>
              </div>

              {/* 👈 INÍCIO DO PASSO A PASSO MINIMIZADO */}
              <div className="mt-2 border-t border-sky-200/50 dark:border-sky-500/30 pt-2">
                  <button
                      type="button"
                      onClick={() => setShowDocs(!showDocs)}
                      className="flex items-center justify-between w-full text-left text-[11px] font-bold text-sky-800 dark:text-sky-300 hover:text-sky-600 transition-colors"
                  >
                      <span>📖 Como instalar a extensão passo a passo?</span>
                      <svg className={`w-4 h-4 transition-transform ${showDocs ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>

                  {showDocs && (
                      <div className="mt-3 space-y-2 text-[10.5px] text-sky-800/90 dark:text-sky-200/90 leading-relaxed bg-sky-100/50 dark:bg-sky-900/30 p-3 rounded-lg border border-sky-200/50 dark:border-sky-700/50">
                          <p><strong>1. Preparar:</strong> Faça o download do arquivo <code>.zip</code> acima. No seu computador, clique com o botão direito sobre ele e selecione <strong>"Extrair Tudo"</strong>.</p>
                          <p><strong>2. Acessar extensões:</strong> Numa nova aba do Google Chrome, digite na barra de endereços: <code>chrome://extensions/</code> e aperte Enter.</p>
                          <p><strong>3. Modo Desenvolvedor:</strong> No canto superior direito da tela de extensões, ative a chave que diz <strong>"Modo do desenvolvedor"</strong>.</p>
                          <p><strong>4. Instalar:</strong> No canto superior esquerdo, clique no botão <strong>"Carregar sem compactação"</strong> e selecione a pasta que você acabou de extrair.</p>
                          <p className="pt-1 border-t border-sky-200/50 dark:border-sky-700/50 mt-2">✨ <strong>Pronto!</strong> A extensão está ativa. Basta manter o painel do aplicativo (ex: GerenciaApp) logado numa aba e usar o UniGestor em outra.</p>
                      </div>
                  )}
              </div>
              {/* 👈 FIM DO PASSO A PASSO */}

              {/* Área de Upload EXCLUSIVA DO MASTER (Você) */}
              {isMasterUser && (
                  <div className="mt-3 pt-3 border-t border-sky-200/50 dark:border-sky-500/30">
                      <p className="text-[9px] font-bold text-slate-500 dark:text-white/50 mb-2 uppercase tracking-widest">
                          Área do Desenvolvedor (Atualizar Extensão)
                      </p>
                      <div className="flex items-center gap-2">
                          <input
                              type="file"
                              accept=".zip"
                              onChange={handleUploadExtension}
                              disabled={isUploading}
                              className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[10px] file:font-bold file:bg-sky-200 file:text-sky-800 hover:file:bg-sky-300 dark:file:bg-sky-600/30 dark:file:text-sky-200 cursor-pointer"
                          />
                          {isUploading && (
                              <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400 animate-pulse">
                                  A enviar...
                              </span>
                          )}
                      </div>
                  </div>
              )}
          </div>

          {/* Aplicativo */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              Aplicativo
            </label>
            <select
              value={appName}
              onChange={(e) => {
                setAppName(e.target.value);
                // Limpa os campos de login/senha se trocar de app para evitar confusão
                setLoginEmail(""); 
                setLoginPassword("");
              }}
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="GERENCIAAPP">GerenciaApp</option>
              <option value="DUPLECAST">DupleCast</option>
            </select>
          </div>

          {/* Label */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              Nome da integração
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder='Ex: "Meu GerenciaApp"'
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1">
              Só para identificar na lista.
            </p>
          </div>

          {/* ✅ NOVO: Link do Painel */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              Link do Painel
            </label>
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="Ex: https://gerenciaapp.top"
              type="url"
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1">
              Endereço exato que a extensão irá acessar.
            </p>
          </div>

          {/* Oculta o Email se for Duplecast (só precisa do PIN) */}
          {appName !== "DUPLECAST" && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
                E-mail de login
              </label>
              <input
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="seuemail@exemplo.com"
                type="email"
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
          )}

          {/* Senha / PIN */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              {appName === "DUPLECAST" ? "PIN Padrão" : "Senha"}
            </label>
            <input
              value={loginPassword}
              onChange={(e) => {
                const val = e.target.value;
                if (appName === "DUPLECAST") {
                  // Aceita apenas números se for DupleCast
                  setLoginPassword(val.replace(/\D/g, ''));
                } else {
                  setLoginPassword(val);
                }
              }}
              placeholder={appName === "DUPLECAST" ? "Apenas números" : "Senha do painel"}
              type="text"
              maxLength={appName === "DUPLECAST" ? 6 : undefined} // Opcional: limitar a 6 dígitos
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1">
              {appName === "DUPLECAST" ? "O PIN é obrigatório (ex: 123456)." : "Fica visível para facilitar manutenção."}
            </p>
          </div>

          {/* Status */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-700 dark:text-white">Integração ativa</div>
              <div className="text-[11px] text-slate-500 dark:text-white/40">
                Se desativar, não será usada nas automações.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={`h-9 px-3 rounded-lg text-xs font-bold border transition-colors ${
                isActive
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
              }`}
            >
              {isActive ? "Ativa" : "Inativa"}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex items-center justify-end gap-2 shrink-0">
          <button
            onClick={onCloseAction}
            className="h-10 px-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
            type="button"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className={`h-10 px-4 rounded-xl text-xs font-bold text-white transition-colors ${
              canSave
                ? "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/20"
                : "bg-slate-300 dark:bg-white/10 cursor-not-allowed"
            }`}
            type="button"
            disabled={!canSave || saving}
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
       </div>

      </div>

      {ConfirmUI} {/* 👈 NOVO: Renderiza a caixa de confirmação por cima do modal */}
    </div>
  );

  return createPortal(modal, document.body);
}
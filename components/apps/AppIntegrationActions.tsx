"use client";
// components/apps/AppIntegrationActions.tsx
//
// Bloco de ações de um app-instância (Configurar/Painel/Verificar/Remover, ou
// os 3 botões via extensão do ClouDDy) — único, usado tanto pelo card de
// aplicativos em app/admin/cliente/novo_cliente.tsx quanto pelo
// components/apps/AppRequestModal.tsx (log de pedidos da Auditoria). Antes
// cada lugar tinha sua própria cópia (ícones diferentes, e o AppRequestModal
// nem tinha o seletor Principal/Secundária no Configurar) — daqui pra frente
// mudar o comportamento de configurar/verificar/remover é mudar um lugar só.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import ReconfigureModeModal, { ReconfigureMode } from "@/components/apps/ReconfigureModeModal";

function IconSparkle({ className = "w-4 h-4 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function IconExternalLink({ className = "w-4 h-4 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

function IconCheckCircle({ className = "w-4 h-4 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconTrash({ className = "w-4 h-4 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

export type AppIntegrationActionsProps = {
  /** ClouDDy e DupleCast usam o fluxo via extensão do Chrome (3 botões),
   * sem API server-side própria — ver lib/apps/clouddy-extension.ts e
   * lib/apps/duplecast-extension.ts. */
  useExtension: boolean;
  /** Handler tem `useApi: true`? Sem isso, nenhum botão é renderizado. */
  hasApiIntegration: boolean;
  /** Nome pro título do seletor Principal/Secundária e pros tooltips. */
  appLabel: string;
  panelUrl: string;
  /** Handler suporta checagem de vencimento (divide Painel em 2 ícones). */
  canCheckVencimento: boolean;
  /** false esconde o botão de Remover (ex: AppRequestModal — a exclusão de
   * verdade acontece pelo botão "Concluir & Excluir" do modal, não aqui). */
  showRemoveButton?: boolean;
  loading?: boolean;
  onOpenPanel: () => void;
  onConfigure: (mode: ReconfigureMode) => void | Promise<void>;
  onCheck: () => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  /** Extensão também é uma automação — segue o mesmo seletor Principal/
   * Secundária das demais antes de mandar pra extensão. */
  onExtensionConfigure: (mode: ReconfigureMode) => void | Promise<void>;
  onExtensionCheck: () => void | Promise<void>;
  onExtensionDelete: () => void | Promise<void>;
};

export default function AppIntegrationActions({
  useExtension,
  hasApiIntegration,
  appLabel,
  panelUrl,
  canCheckVencimento,
  showRemoveButton = true,
  loading = false,
  onOpenPanel,
  onConfigure,
  onCheck,
  onRemove,
  onExtensionConfigure,
  onExtensionCheck,
  onExtensionDelete,
}: AppIntegrationActionsProps) {
  const [showReconfigure, setShowReconfigure] = useState(false);

  if (useExtension) {
    return (
      <div className="bg-transparent border-0">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setShowReconfigure(true)}
            disabled={loading}
            className="h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
            title="Configura com o M3U do cliente e pega o vencimento"
          >
            {loading ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <IconSparkle />}
            Configurar
          </button>
          <div className="h-10 rounded-lg border border-border overflow-hidden flex divide-x divide-border">
            <button
              type="button"
              onClick={onOpenPanel}
              disabled={loading}
              className="flex-1 bg-transparent text-muted-foreground hover:bg-muted disabled:opacity-60 transition-colors flex items-center justify-center"
              title="Abrir painel no navegador"
            >
              <IconExternalLink />
            </button>
            <button
              type="button"
              onClick={() => onExtensionCheck()}
              disabled={loading}
              className="flex-1 bg-transparent text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-60 transition-colors flex items-center justify-center"
              title="Verificar vencimento (sem mexer na configuração)"
            >
              {loading ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <IconCheckCircle />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => onExtensionDelete()}
            disabled={loading}
            className="h-10 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
            title="Remove a configuração"
          >
            {loading ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <IconTrash />}
            Remover
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Cada clique abre uma aba de verdade no seu Chrome, faz a ação e fecha a sessão. Se aparecer alguma
          verificação do Cloudflare, resolve manualmente na aba — o resto continua sozinho.
        </p>
        <ReconfigureModeModal
          open={showReconfigure}
          onClose={() => setShowReconfigure(false)}
          appName={appLabel}
          onChoose={(mode) => {
            setShowReconfigure(false);
            onExtensionConfigure(mode);
          }}
        />
      </div>
    );
  }

  if (!hasApiIntegration) return null;

  const showRemove = showRemoveButton && !!onRemove;
  const cols = showRemove ? "grid-cols-3" : "grid-cols-2";

  return (
    <div className="bg-transparent border-0">
      <div className={`grid gap-2 ${cols}`}>
        <button
          type="button"
          onClick={() => setShowReconfigure(true)}
          disabled={loading}
          className="h-10 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
          title="Enviar dados para o painel"
        >
          {loading ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <IconSparkle />}
          <span className="hidden sm:inline">Configurar m3u</span>
          <span className="sm:hidden">Configurar</span>
        </button>

        {canCheckVencimento ? (
          <div className="h-10 rounded-lg border border-border overflow-hidden flex divide-x divide-border">
            <button
              type="button"
              onClick={onOpenPanel}
              disabled={loading}
              className="flex-1 bg-transparent text-muted-foreground hover:bg-muted disabled:opacity-60 transition-colors flex items-center justify-center"
              title="Abrir painel no navegador"
            >
              <IconExternalLink />
            </button>
            <button
              type="button"
              onClick={() => onCheck()}
              disabled={loading}
              className="flex-1 bg-transparent text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-60 transition-colors flex items-center justify-center"
              title="Verificar vencimento no painel"
            >
              {loading ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <IconCheckCircle />}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenPanel}
            disabled={loading}
            className="h-10 rounded-lg bg-transparent border border-border text-muted-foreground hover:bg-muted disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
            title="Abrir painel no navegador"
          >
            <IconExternalLink />
            <span className="hidden sm:inline text-xs font-medium">Painel</span>
          </button>
        )}

        {showRemove && (
          <button
            type="button"
            onClick={() => onRemove!()}
            disabled={loading}
            className="h-10 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 hover:bg-rose-500/20 disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
            title="Remover do painel oficial"
          >
            {loading ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <IconTrash />}
            <span className="hidden sm:inline">Remover m3u</span>
            <span className="sm:hidden">Remover</span>
          </button>
        )}
      </div>

      <ReconfigureModeModal
        open={showReconfigure}
        onClose={() => setShowReconfigure(false)}
        appName={appLabel}
        onChoose={(mode) => {
          setShowReconfigure(false);
          onConfigure(mode);
        }}
      />
    </div>
  );
}

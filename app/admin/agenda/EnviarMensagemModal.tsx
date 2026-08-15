"use client";
// app/admin/agenda/EnviarMensagemModal.tsx
// Extraído de page.tsx (14/08/2026) — modal "Enviar Mensagem Rápida",
// carrega via next/dynamic só quando abre. sessionOptions/selectedSessionNow
// continuam vivendo no page.tsx (pré-carregados no mount da página, e o
// valor escolhido persiste entre aberturas do modal — comportamento
// original preservado de propósito).
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Modal, IconSend, displayPhone } from "./shared";

export default function EnviarMensagemModal({
  contactId,
  phone,
  tenantId,
  sessionOptions,
  selectedSessionNow,
  setSelectedSessionNow,
  addToast,
  onClose,
}: {
  contactId: string;
  phone: string;
  tenantId: string | null;
  sessionOptions: { id: string; label: string }[];
  selectedSessionNow: string;
  setSelectedSessionNow: (v: string) => void;
  addToast: (
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
  ) => void;
  onClose: () => void;
}) {
  const [messageText, setMessageText] = useState("");
  const [sendingNow, setSendingNow] = useState(false);

  async function handleSendMessage() {
    if (!tenantId || !contactId || !phone) return;
    const msg = messageText.trim();
    if (!msg) return addToast("error", "Mensagem vazia", "Digite algo.");
    setSendingNow(true);
    try {
      const { data: session } = await supabaseBrowser.auth.getSession();
      const token = session.session?.access_token;

      const res = await fetch("/api/whatsapp/envio_avulso", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          phone,
          message: msg,
          whatsapp_session: selectedSessionNow,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Falha ao enviar");
      }
      addToast("success", "Enviado", "Mensagem enviada com sucesso.");
      onClose();
    } catch (e: any) {
      addToast("error", "Falha no envio", e.message);
    } finally {
      setSendingNow(false);
    }
  }

  return (
    <Modal title="Enviar Mensagem Rápida" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg flex items-center gap-3">
          <span className="text-xl">
            <MessageCircle className="w-4 h-4" />
          </span>
          <div className="text-sm text-emerald-700">
            Enviando para <strong>{displayPhone(phone)}</strong>
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
            Sessão WhatsApp
          </label>
          <select
            value={selectedSessionNow}
            onChange={(e) => setSelectedSessionNow(e.target.value)}
            className="w-full h-11 px-3 bg-transparent border border-border rounded-xl text-foreground outline-none text-sm font-medium"
          >
            {sessionOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          className="w-full bg-transparent border border-border rounded-xl p-4 text-foreground outline-none min-h-[120px] text-sm resize-none"
          placeholder="Digite a sua mensagem..."
          autoFocus
        />
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-muted-foreground text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={handleSendMessage}
            disabled={sendingNow}
            className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <IconSend /> {sendingNow ? "Enviando..." : "Enviar Agora"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

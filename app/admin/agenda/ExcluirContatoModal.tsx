"use client";
// app/admin/agenda/ExcluirContatoModal.tsx
// Extraído de page.tsx (14/08/2026) — confirmação de exclusão de contato,
// carrega via next/dynamic só quando abre.
import { useState } from "react";
import { Modal, type GoogleContact } from "./shared";

export default function ExcluirContatoModal({
  contact,
  addToast,
  onClose,
  onSuccess,
}: {
  contact: GoogleContact;
  addToast: (
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
  ) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [deleteFromGoogle, setDeleteFromGoogle] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDeleteContact() {
    setIsDeleting(true);
    try {
      const res = await fetch("/api/auth/google/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: contact.id,
          resourceName: contact.google_resource_name,
          deleteFromGoogle,
        }),
      });
      if (!res.ok) throw new Error("Erro ao excluir.");
      const resData = await res.json().catch(() => ({}));
      if (deleteFromGoogle && resData?.googleDeleteFailed) {
        addToast(
          "error",
          "Removido só do sistema",
          "Não foi possível excluir do Google (token expirado ou falha na API). O contato pode continuar no celular.",
        );
      } else {
        addToast(
          "success",
          "Excluído",
          `Contato removido${deleteFromGoogle ? " do sistema e do Google" : " apenas do sistema"}.`,
        );
      }
      onSuccess();
    } catch (err: any) {
      addToast("error", "Aviso de API", err.message);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Modal title="Excluir Contato" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Você está prestes a excluir o contato{" "}
          <strong>{contact.display_name}</strong>.
        </p>
        <label className="flex items-center gap-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={deleteFromGoogle}
            onChange={(e) => setDeleteFromGoogle(e.target.checked)}
            className="w-5 h-5 rounded border-rose-300 text-rose-400 focus:ring-rose-500"
          />
          <span className="text-sm font-medium text-rose-700">
            Excluir também da agenda do celular (Google Contacts)
          </span>
        </label>
        <div className="flex justify-end gap-3 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-muted-foreground text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={handleDeleteContact}
            disabled={isDeleting}
            className="px-6 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {isDeleting ? "Excluindo..." : "Confirmar Exclusão"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

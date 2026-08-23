"use client";
// app/admin/settings/condominio/ModalCondominio.tsx
// Cria E edita no mesmo modal (condominio=null → criar, condominio=objeto →
// editar) — mesmo contrato de app/admin/gerenciador/servidor/novo_servidor.tsx.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import imageCompression from "browser-image-compression";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/hooks/useConfirm";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import type { CondominioRow } from "./shared";

type Props = {
  condominio?: CondominioRow | null;
  onClose: () => void;
  onSuccess: () => void;
  onError?: (msg: string) => void;
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground mb-1.5 tracking-tight">
      {children}
    </label>
  );
}

function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 placeholder-muted-foreground/40 outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border border-border bg-transparent cursor-pointer shrink-0 p-1"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#1E3A8A"
          className="flex-1"
        />
      </div>
    </div>
  );
}

export default function ModalCondominio({
  condominio,
  onClose,
  onSuccess,
  onError,
}: Props) {
  const tenantId = useTenantId();
  const { confirm } = useConfirm();
  const alertError = (msg: string) =>
    onError
      ? Promise.resolve(onError(msg))
      : confirm({
          title: "Erro",
          subtitle: msg,
          tone: "rose",
          confirmText: "OK",
          cancelText: "",
        });
  const isEditing = !!condominio;
  const [saving, setSaving] = useState(false);

  const [nome, setNome] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [endereco, setEndereco] = useState("");
  const [contato, setContato] = useState("");
  const [gestao, setGestao] = useState("");
  const [slogan1, setSlogan1] = useState("");
  const [slogan2, setSlogan2] = useState("");
  const [corPrimaria, setCorPrimaria] = useState("");
  const [corSecundaria, setCorSecundaria] = useState("");

  useEffect(() => {
    if (condominio) {
      setNome(condominio.nome);
      setLogoUrl(condominio.logo_url || "");
      setEndereco(condominio.endereco || "");
      setContato(condominio.contato || "");
      setGestao(condominio.gestao || "");
      setSlogan1(condominio.slogan1 || "");
      setSlogan2(condominio.slogan2 || "");
      setCorPrimaria(condominio.cor_primaria || "");
      setCorSecundaria(condominio.cor_secundaria || "");
    }
  }, [condominio]);

  async function handleLogoUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      await alertError("Arquivo inválido. Selecione uma imagem.");
      return;
    }
    try {
      setUploadingLogo(true);
      // ✅ Comprime no browser antes de subir (pedido do Márcio) — é logo,
      // não foto, então 800px/0.5MB já sobra de qualidade pro cabeçalho do
      // PDF, e evita gastar storage/banda à toa com o arquivo original.
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 800,
        useWebWorker: true,
      });

      const res = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: compressed.type || file.type,
          folder: "condominios",
        }),
      });
      const { presignedUrl, publicUrl } = await res.json();
      await fetch(presignedUrl, {
        method: "PUT",
        body: compressed,
        headers: { "Content-Type": compressed.type || file.type },
      });
      setLogoUrl(publicUrl);
    } catch (e: any) {
      await alertError("Erro no upload: " + e?.message);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSave() {
    if (!nome.trim()) {
      await alertError("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        nome: nome.trim(),
        logo_url: logoUrl || null,
        endereco: endereco.trim() || null,
        contato: contato.trim() || null,
        gestao: gestao.trim() || null,
        slogan1: slogan1.trim() || null,
        slogan2: slogan2.trim() || null,
        cor_primaria: corPrimaria.trim() || null,
        cor_secundaria: corSecundaria.trim() || null,
      };

      if (isEditing && condominio) {
        const { error } = await supabaseBrowser
          .from("condominios")
          .update(payload)
          .eq("id", condominio.id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
      } else {
        const { error } = await supabaseBrowser
          .from("condominios")
          .insert(payload);
        if (error) throw error;
      }

      onSuccess();
    } catch (e: any) {
      await alertError(e?.message || "Erro ao salvar condomínio.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <ModalHeader onClose={onClose}>
        <h2 className="text-base font-semibold text-foreground">
          {isEditing ? `Editar: ${condominio?.nome}` : "Novo Condomínio"}
        </h2>
      </ModalHeader>

      <ModalBody className="p-4 sm:p-6 space-y-4">
        <div>
          <Label>Nome</Label>
          <Input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: Condomínio Vidamérica"
          />
        </div>

        <div>
          <Label>Logo do Condomínio</Label>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) handleLogoUpload(file);
            }}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files).find((f) =>
                f.type.startsWith("image/"),
              );
              if (file) handleLogoUpload(file);
            }}
            className="flex items-center gap-4 p-3 border-2 border-dashed border-border rounded-xl hover:border-emerald-500/50 transition-colors"
            tabIndex={0}
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Logo"
                className="w-12 h-12 rounded-lg object-cover border border-border shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-transparent border border-border flex items-center justify-center shrink-0 text-2xl">
                🏢
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                {uploadingLogo
                  ? "Enviando..."
                  : "Arraste, cole (Ctrl+V) ou clique para selecionar"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                PNG, JPG, WebP — comprimida automaticamente antes do upload
              </p>
            </div>
            <label className="cursor-pointer shrink-0">
              <span className="h-8 px-3 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-xs font-medium flex items-center hover:bg-emerald-500/20 transition-colors">
                {uploadingLogo ? "..." : "Selecionar"}
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingLogo}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoUpload(f);
                  e.target.value = "";
                }}
              />
            </label>
            {logoUrl && (
              <button
                type="button"
                onClick={() => setLogoUrl("")}
                className="shrink-0 p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors"
                title="Remover logo"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Endereço</Label>
            <Input
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder="Ex: Av. das Américas, 1000"
            />
          </div>
          <div>
            <Label>Contato</Label>
            <Input
              value={contato}
              onChange={(e) => setContato(e.target.value)}
              placeholder="Ex: (21) 99999-9999"
            />
          </div>
        </div>

        <div>
          <Label>Gestão</Label>
          <Input
            value={gestao}
            onChange={(e) => setGestao(e.target.value)}
            placeholder="Ex: Administradora XPTO / Síndico Fulano"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Slogan 1</Label>
            <Input
              value={slogan1}
              onChange={(e) => setSlogan1(e.target.value)}
              placeholder="Ex: Juntos, cuidamos melhor da nossa casa."
            />
          </div>
          <div>
            <Label>Slogan 2</Label>
            <Input
              value={slogan2}
              onChange={(e) => setSlogan2(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <ColorField
            label="Cor Primária"
            value={corPrimaria}
            onChange={setCorPrimaria}
          />
          <ColorField
            label="Cor Secundária"
            value={corSecundaria}
            onChange={setCorSecundaria}
          />
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || uploadingLogo}
          className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          {saving
            ? "Salvando..."
            : isEditing
              ? "Salvar alterações"
              : "Criar condomínio"}
        </button>
      </ModalFooter>
    </Modal>
  );
}

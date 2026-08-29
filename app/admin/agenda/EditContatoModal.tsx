"use client";
// app/admin/agenda/EditContatoModal.tsx
// Extraído de page.tsx (14/08/2026) — modal de Criar/Editar Contato, o mais
// pesado dos 3 (form completo: foto, telefones com validação de WhatsApp e
// operadora, e-mails, grupos). Carrega via next/dynamic só quando abre.
import { useRef, useState } from "react";
import {
  Loader2,
  Camera,
  Lock,
  Radio,
  AlertTriangle,
  Globe,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Modal,
  IconTrash,
  DDI_OPTIONS,
  onlyDigits,
  inferDDI,
  formatNational,
  parsePhoneToEditPhone,
  getPhonesArray,
  getEmailsArray,
  type GoogleContact,
  type EditPhone,
  type EditEmail,
} from "./shared";

// WA validation por phoneId
type WaValidation = {
  loading?: boolean;
  exists?: boolean;
  jid?: string;
  disconnected?: boolean;
  photoStatus?: "loading" | "synced" | "protected" | null;
  opLoading?: boolean;
  opName?: string;
  opError?: boolean;
} | null;

export default function EditContatoModal({
  contact,
  tenantId,
  uniqueLabels,
  addToast,
  onClose,
  onSuccess,
  onDataChanged,
}: {
  contact: GoogleContact | null;
  tenantId: string | null;
  uniqueLabels: string[];
  addToast: (
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
  ) => void;
  onClose: () => void;
  onSuccess: () => void;
  // ✅ Diferente de onSuccess (salva e fecha): a sincronização de foto do
  // WhatsApp atualiza dados em segundo plano SEM fechar o modal — só avisa
  // o pai pra atualizar a lista por trás.
  onDataChanged: () => void;
}) {
  const [editForm, setEditForm] = useState<{
    display_name: string;
    phones: EditPhone[];
    emails: EditEmail[];
    labels: string[];
    new_photo_base64?: string;
  }>(() => {
    if (contact) {
      const phones = getPhonesArray(contact).map((p) =>
        parsePhoneToEditPhone(p.value, p.label, p.id),
      );
      const emails = getEmailsArray(contact).map((e) => ({ ...e }));
      return {
        display_name: contact.display_name || "",
        phones,
        emails,
        labels: contact.labels || [],
        new_photo_base64: undefined,
      };
    }
    return {
      display_name: "",
      phones: [
        {
          id: Date.now().toString(),
          label: "Celular",
          ddi: "55",
          national: "",
          confirmed: false,
        },
      ],
      emails: [],
      labels: [],
      new_photo_base64: undefined,
    };
  });
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Preview local do avatar sincronizado via WhatsApp — `contact` é prop
  // (não pode ser mutado como no `editModal.contact` original), então o
  // resultado de uma sincronização de foto fica aqui até o modal recarregar.
  const [syncedAvatarUrl, setSyncedAvatarUrl] = useState<string | null>(null);

  const [waValidations, setWaValidations] = useState<
    Record<string, WaValidation>
  >({});
  const waTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  async function validateWaForPhone(
    phoneId: string,
    e164: string,
    autoSyncContactId?: string,
  ) {
    const digits = onlyDigits(e164);
    if (digits.length < 8) {
      setWaValidations((prev) => {
        const n = { ...prev };
        delete n[phoneId];
        return n;
      });
      return;
    }
    // Preserva o estado anterior e ativa SÓ o loading do WA
    setWaValidations((prev) => ({
      ...prev,
      [phoneId]: { ...(prev[phoneId] || {}), loading: true },
    }));

    try {
      const res = await fetch("/api/whatsapp/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const json = await res.json().catch(() => ({}));

      // Preserva o estado anterior e atualiza SÓ o status do WA
      setWaValidations((prev) => ({
        ...prev,
        [phoneId]: {
          ...(prev[phoneId] || {}),
          loading: false,
          exists: !!json.exists,
          jid: json.jid,
          disconnected: !!json.disconnected,
        },
      }));

      // Auto-sync foto se WA ativo e contactId fornecido
      if (json.exists && json.jid && autoSyncContactId) {
        setTimeout(
          () => handleSyncWaPhotoSilent(autoSyncContactId, json.jid, phoneId),
          300,
        );
      }
    } catch {
      setWaValidations((prev) => ({
        ...prev,
        [phoneId]: { ...(prev[phoneId] || {}), loading: false, exists: false },
      }));
    }
  }

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () =>
        setEditForm((prev) => ({
          ...prev,
          new_photo_base64: reader.result as string,
        }));
      reader.readAsDataURL(file);
    }
  };

  // Confirma e normaliza um telefone do modal, e dispara APENAS a validação de Operadora
  function confirmPhone(idx: number) {
    setEditForm((prev) => {
      const phones = [...prev.phones];
      const p = phones[idx];
      let digits = onlyDigits(p.national);

      // Strip zero inicial para Brasil (ex: "021..." → "21...")
      if (p.ddi === "55" && digits.startsWith("0")) digits = digits.slice(1);
      if (digits.length < 8) {
        phones[idx] = { ...p, confirmed: false };
        return { ...prev, phones };
      }

      let ddi = p.ddi;
      let national = digits;
      if (digits.length > 11) {
        ddi = inferDDI(digits);
        national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
      }
      const formatted = formatNational(ddi, national);
      phones[idx] = {
        ...p,
        ddi,
        national: formatted || national,
        confirmed: true,
      };

      // Dispara APENAS a validação de Operadora/País com debounce
      const cleanNational = onlyDigits(formatted || national);
      if (waTimers.current[p.id]) clearTimeout(waTimers.current[p.id]);

      waTimers.current[p.id] = setTimeout(() => {
        lookupOperadoraForPhone(p.id, ddi, cleanNational); // 🚀 CHAMA A OPERADORA
      }, 400);

      return { ...prev, phones };
    });
  }

  // Sincroniza foto do WhatsApp (requer rota /api/whatsapp/contact-photo na VM)
  async function handleSyncWaPhoto(phoneId: string, contactId: string) {
    const wa = waValidations[phoneId];
    if (!wa?.exists || !wa.jid) return;
    try {
      const res = await fetch("/api/whatsapp/contact-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, jid: wa.jid }),
      });
      const data = await res.json();
      if (res.ok && data.avatar_url) {
        addToast(
          "success",
          "Foto atualizada",
          "Foto do WhatsApp sincronizada com sucesso.",
        );
        setSyncedAvatarUrl(data.avatar_url);
        onDataChanged();
      } else {
        addToast(
          "warning",
          "Foto não sincronizada",
          data.error || "Este contato tem a foto privada no WhatsApp.",
        );
      }
    } catch {
      addToast(
        "error",
        "Erro",
        "Rota /api/whatsapp/contact-photo ainda não implementada na VM.",
      );
    }
  }

  async function handleSyncWaPhotoSilent(
    contactId: string,
    jid: string,
    phoneId?: string,
  ) {
    if (phoneId)
      setWaValidations((prev) => ({
        ...prev,
        [phoneId]: { ...prev[phoneId]!, photoStatus: "loading" },
      }));
    try {
      const res = await fetch("/api/whatsapp/contact-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, jid }),
      });
      const data = await res.json();
      if (res.ok && data.avatar_url) {
        if (phoneId)
          setWaValidations((prev) => ({
            ...prev,
            [phoneId]: { ...prev[phoneId]!, photoStatus: "synced" },
          }));
        setSyncedAvatarUrl(data.avatar_url);
        onDataChanged();
      } else {
        if (phoneId)
          setWaValidations((prev) => ({
            ...prev,
            [phoneId]: { ...prev[phoneId]!, photoStatus: "protected" },
          }));
      }
    } catch {
      if (phoneId)
        setWaValidations((prev) => ({
          ...prev,
          [phoneId]: { ...prev[phoneId]!, photoStatus: "protected" },
        }));
    }
  }

  // Busca a operadora on the fly para o modal de edição
  async function lookupOperadoraForPhone(
    phoneId: string,
    ddi: string,
    digits: string,
  ) {
    if (digits.length < 5) return;

    // 1. Ativa o loading visual da operadora SEM sobrescrever o WA com false
    setWaValidations((prev) => ({
      ...prev,
      [phoneId]: { ...(prev[phoneId] || {}), opLoading: true, opError: false },
    }));
    try {
      const res = await fetch("/api/auth/google/lookup-operadora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: `${ddi}${digits}` }),
      });

      if (!res.ok) throw new Error("Erro na API");
      const data = await res.json();

      if (data.operadora) {
        // Atualiza o label (e, se a Telein recuperou um celular antigo sem o
        // 9º dígito — achado 28/08/2026 — também corrige o número exibido)
        setEditForm((prev) => {
          const phones = [...prev.phones];
          const index = phones.findIndex((x) => x.id === phoneId);
          if (index > -1) {
            phones[index] = {
              ...phones[index],
              label: data.operadora,
              ...(data.correctedNational
                ? {
                    national: formatNational("55", data.correctedNational),
                    confirmed: true,
                  }
                : {}),
            };
          }
          return { ...prev, phones };
        });
        // Sucesso
        setWaValidations((prev) => ({
          ...prev,
          [phoneId]: {
            ...prev[phoneId]!,
            opLoading: false,
            opName: data.operadora,
            opError: false,
          },
        }));
      } else {
        // Falha (não encontrou operadora)
        setWaValidations((prev) => ({
          ...prev,
          [phoneId]: { ...prev[phoneId]!, opLoading: false, opError: true },
        }));
      }
    } catch {
      // Falha (erro na requisição)
      setWaValidations((prev) => ({
        ...prev,
        [phoneId]: { ...prev[phoneId]!, opLoading: false, opError: true },
      }));
    }
  }

  async function handleSaveContact() {
    setIsSaving(true);
    try {
      const isNew = !contact;
      const endpoint = isNew
        ? "/api/auth/google/create"
        : "/api/auth/google/update";

      // Reconstrói os phones com e164 completo para o backend
      const phones = editForm.phones
        .filter((p) => p.national.trim())
        .map((p) => ({
          label: p.label,
          value: `+${p.ddi}${onlyDigits(p.national)}`,
        }));

      const payload = {
        id: contact?.id,
        google_resource_name: contact?.google_resource_name,
        display_name: editForm.display_name,
        phones,
        emails: editForm.emails.map((e) => ({
          label: e.label,
          value: e.value,
        })),
        labels: editForm.labels,
        photo_base64: editForm.new_photo_base64,
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Erro ao salvar.");
      }
      addToast(
        "success",
        "Salvo",
        `Contato ${isNew ? "criado" : "atualizado"} com sucesso.`,
      );
      onSuccess();
    } catch (err: any) {
      addToast("error", "Aviso de API", err.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal title={contact ? "Editar Contato" : "Novo Contato"} onClose={onClose}>
      <div className="space-y-5">
        {/* Foto clicável */}
        <div
          className="flex justify-center mb-2 relative group w-24 h-24 mx-auto cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handlePhotoUpload}
          />
          {editForm.new_photo_base64 || syncedAvatarUrl || contact?.avatar_url ? (
            <img
              src={
                editForm.new_photo_base64 ||
                syncedAvatarUrl ||
                contact?.avatar_url ||
                ""
              }
              alt="Foto"
              className="w-24 h-24 rounded-full object-cover border-2 border-border group-hover:opacity-50 transition-opacity"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-transparent flex items-center justify-center font-medium text-muted-foreground text-2xl group-hover:opacity-50 transition-opacity">
              {editForm.display_name?.charAt(0) || "?"}
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-foreground drop-shadow-md text-sm font-medium">
            <Camera className="w-4 h-4" /> Alterar
          </div>
        </div>

        {/* Nome */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Nome Completo
          </label>
          <input
            value={editForm.display_name}
            onChange={(e) =>
              setEditForm({ ...editForm, display_name: e.target.value })
            }
            className="w-full p-2.5 border border-border rounded-lg bg-transparent text-foreground outline-none focus:border-amber-500 text-sm font-medium"
          />
        </div>

        <div className="border-t border-border" />

        {/* ── TELEFONES ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="block text-xs font-medium text-muted-foreground">
              Telefones
            </label>
            <button
              onClick={() =>
                setEditForm((prev) => ({
                  ...prev,
                  phones: [
                    ...prev.phones,
                    {
                      id: Date.now().toString(),
                      label: "Celular",
                      ddi: "55",
                      national: "",
                      confirmed: false,
                    },
                  ],
                }))
              }
              className="text-xs text-amber-500 hover:text-amber-600 font-medium flex items-center gap-1"
            >
              + Add Telefone
            </button>
          </div>

          <div className="space-y-4">
            {editForm.phones.map((p, idx) => {
              const wa = waValidations[p.id];
              const e164Preview =
                p.confirmed && p.national
                  ? `+${p.ddi}${onlyDigits(p.national)}`
                  : null;

              return (
                <div
                  key={p.id}
                  className="space-y-2 p-3 rounded-lg border border-border bg-transparent/50"
                >
                  {/* Linha 1: rótulo + DDI + número + confirmar + remover */}
                  <div className="flex gap-2 items-center">
                    {/* Rótulo */}
                    <input
                      placeholder="Rótulo"
                      value={p.label}
                      onChange={(e) =>
                        setEditForm((prev) => {
                          const phones = [...prev.phones];
                          phones[idx] = {
                            ...phones[idx],
                            label: e.target.value,
                          };
                          return { ...prev, phones };
                        })
                      }
                      className="w-20 p-2 border border-border rounded-lg bg-transparent text-foreground text-xs font-medium"
                    />
                    {/* DDI */}
                    <select
                      value={p.ddi}
                      onChange={(e) =>
                        setEditForm((prev) => {
                          const phones = [...prev.phones];
                          phones[idx] = {
                            ...phones[idx],
                            ddi: e.target.value,
                            confirmed: false,
                          };
                          return { ...prev, phones };
                        })
                      }
                      className="h-9 px-2 bg-transparent border border-border rounded-lg text-xs text-foreground/90"
                    >
                      {DDI_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.flag} +{o.code}
                        </option>
                      ))}
                    </select>
                    {/* Número nacional */}
                    <input
                      placeholder={p.ddi === "55" ? "21 99999-9999" : "número"}
                      value={p.national}
                      onChange={(e) =>
                        setEditForm((prev) => {
                          const phones = [...prev.phones];
                          phones[idx] = {
                            ...phones[idx],
                            national: e.target.value,
                            confirmed: false,
                          };
                          return { ...prev, phones };
                        })
                      }
                      onBlur={() => confirmPhone(idx)}
                      className="flex-1 p-2 border border-border rounded-lg bg-transparent text-foreground text-sm min-w-0"
                    />

                    {/* Remover */}
                    <button
                      onClick={() => {
                        setEditForm((prev) => ({
                          ...prev,
                          phones: prev.phones.filter((x) => x.id !== p.id),
                        }));
                        setWaValidations((prev) => {
                          const n = { ...prev };
                          delete n[p.id];
                          return n;
                        });
                      }}
                      className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg"
                    >
                      <IconTrash />
                    </button>
                  </div>

                  {/* Linha 2: Botões de Ação e Status */}
                  <div className="flex flex-wrap items-center gap-2 px-1">
                    {/* Botão 1: WhatsApp Status */}
                    <button
                      onClick={() => {
                        const clean = onlyDigits(p.national);
                        if (clean.length >= 8)
                          validateWaForPhone(p.id, `+${p.ddi}${clean}`);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors inline-flex items-center gap-1 ${
                        wa?.loading
                          ? "bg-transparent text-muted-foreground border-border"
                          : wa?.disconnected
                            ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                            : wa?.exists
                              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              : wa?.exists === false
                                ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {wa?.loading ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />{" "}
                          Validando...
                        </>
                      ) : wa?.disconnected ? (
                        <>⚠️ Sessão desconectada</>
                      ) : wa?.exists ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" /> WhatsApp Ativo
                        </>
                      ) : wa?.exists === false && p.confirmed ? (
                        <>
                          <XCircle className="w-3 h-3" /> Não Encontrado
                        </>
                      ) : (
                        "Status WhatsApp"
                      )}
                    </button>

                    {/* Botão 2: Sincronizar Foto */}
                    <button
                      onClick={() => {
                        const clean = onlyDigits(p.national);
                        if (!contact?.id) {
                          addToast(
                            "warning",
                            "Atenção",
                            "Salve o contato antes de sincronizar a foto.",
                          );
                          return;
                        }

                        if (wa?.exists && wa?.jid) {
                          // Já possui o JID validado, busca a foto direto
                          handleSyncWaPhotoSilent(contact.id, wa.jid, p.id);
                        } else if (clean.length >= 8) {
                          // Não validou o WA ainda: ativa o loading visual da foto, valida o WA e passa o ID para o auto-sync da foto rodar em seguida
                          setWaValidations((prev) => ({
                            ...prev,
                            [p.id]: {
                              ...prev[p.id],
                              photoStatus: "loading",
                            },
                          }));
                          validateWaForPhone(
                            p.id,
                            `+${p.ddi}${clean}`,
                            contact.id,
                          );
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors inline-flex items-center gap-1 ${
                        wa?.photoStatus === "loading"
                          ? "bg-transparent text-muted-foreground border-border"
                          : wa?.photoStatus === "synced"
                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                            : wa?.photoStatus === "protected"
                              ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                              : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {wa?.photoStatus === "loading" ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />{" "}
                          Buscando Foto...
                        </>
                      ) : wa?.photoStatus === "synced" ? (
                        <>
                          <Camera className="w-3 h-3" /> Foto Sincronizada
                        </>
                      ) : wa?.photoStatus === "protected" ? (
                        <>
                          <Lock className="w-3 h-3" /> Foto Protegida
                        </>
                      ) : (
                        "Sincronizar Foto"
                      )}
                    </button>

                    {/* Botão 3: Sincronizar Operadora / Info do País */}
                    {p.ddi === "55" ? (
                      <button
                        onClick={() => {
                          const clean = onlyDigits(p.national);
                          if (clean.length >= 10)
                            lookupOperadoraForPhone(p.id, p.ddi, clean);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors inline-flex items-center gap-1 ${
                          wa?.opLoading
                            ? "bg-transparent text-muted-foreground border-border"
                            : wa?.opName
                              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              : wa?.opError
                                ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {wa?.opLoading ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />{" "}
                            Buscando...
                          </>
                        ) : wa?.opName ? (
                          <>
                            <Radio className="w-3 h-3" /> Operadora Atualizada
                          </>
                        ) : wa?.opError ? (
                          <>
                            <AlertTriangle className="w-3 h-3" /> Falha ao
                            buscar
                          </>
                        ) : (
                          "Sincronizar Operadora"
                        )}
                      </button>
                    ) : (
                      <div className="px-3 py-1.5 rounded-lg text-[11px] font-medium border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 flex items-center gap-1 cursor-default">
                        <Globe className="w-3 h-3" />
                        {DDI_OPTIONS.find((o) => o.code === p.ddi)?.label ||
                          "Internacional"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {editForm.phones.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                Nenhum telefone.
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border" />

        {/* ── EMAILS ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-medium text-muted-foreground">
              E-mails
            </label>
            <button
              onClick={() =>
                setEditForm((prev) => ({
                  ...prev,
                  emails: [
                    ...prev.emails,
                    {
                      id: Date.now().toString(),
                      label: "Pessoal",
                      value: "",
                    },
                  ],
                }))
              }
              className="text-xs text-amber-500 hover:text-amber-600 font-medium"
            >
              + Add E-mail
            </button>
          </div>
          <div className="space-y-2">
            {editForm.emails.map((e, idx) => (
              <div key={e.id} className="flex gap-2 items-center">
                <input
                  placeholder="Rótulo"
                  value={e.label}
                  onChange={(ev) =>
                    setEditForm((prev) => {
                      const emails = [...prev.emails];
                      emails[idx] = {
                        ...emails[idx],
                        label: ev.target.value,
                      };
                      return { ...prev, emails };
                    })
                  }
                  className="w-20 p-2 border border-border rounded-lg bg-transparent text-foreground text-xs font-medium"
                />
                <input
                  placeholder="email@exemplo.com"
                  value={e.value}
                  onChange={(ev) =>
                    setEditForm((prev) => {
                      const emails = [...prev.emails];
                      emails[idx] = {
                        ...emails[idx],
                        value: ev.target.value,
                      };
                      return { ...prev, emails };
                    })
                  }
                  className="flex-1 p-2 border border-border rounded-lg bg-transparent text-foreground text-sm"
                />
                <button
                  onClick={() =>
                    setEditForm((prev) => ({
                      ...prev,
                      emails: prev.emails.filter((x) => x.id !== e.id),
                    }))
                  }
                  className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg"
                >
                  <IconTrash />
                </button>
              </div>
            ))}
            {editForm.emails.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                Nenhum e-mail.
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border" />

        {/* ── GRUPOS ── */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Grupos / Marcadores (Google)
          </label>
          <input
            value={(editForm.labels || []).join(", ")}
            onChange={(e) =>
              setEditForm({
                ...editForm,
                labels: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s),
              })
            }
            className="w-full p-2.5 border border-border rounded-lg bg-transparent text-foreground outline-none focus:border-amber-500 text-sm"
            placeholder="Ex: VIP, Família, Empresa"
          />
          {/* Tags clicáveis dos grupos existentes */}
          {uniqueLabels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {uniqueLabels.map((lbl) => {
                const active = editForm.labels.includes(lbl);
                return (
                  <button
                    key={lbl}
                    onClick={() =>
                      setEditForm((prev) => ({
                        ...prev,
                        labels: active
                          ? prev.labels.filter((l) => l !== lbl)
                          : [...prev.labels, lbl],
                      }))
                    }
                    className={`text-[10px] px-2 py-0.5 rounded font-medium border transition-colors ${active ? "bg-amber-500 text-white border-amber-500" : "bg-transparent text-muted-foreground border-border hover:bg-muted"}`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Botões */}
        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-muted-foreground text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveContact}
            disabled={isSaving}
            className="px-6 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-medium flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {isSaving ? "Salvando..." : "Salvar no Google"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

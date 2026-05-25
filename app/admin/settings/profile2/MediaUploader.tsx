"use client";

import { useState, useRef } from "react";
import imageCompression from "browser-image-compression";
import { useConfirm } from "@/app/admin/HookuseConfirm"; // ✅ 1. Import adicionado

interface MediaUploaderProps {
  label: string;
  maxFiles?: number;
  accept?: string;
  // ✅ uploadedUrls: URLs já no R2 (para vídeos enviados via presigned URL)
  onFilesReady: (files: File[], uploadedUrls?: (string | undefined)[]) => void;
  initialUrls?: string[];
  onRemoveInitialUrl?: (url: string) => void;
}

type MediaPreview = {
  id: string;
  url: string;
  type: string;
  name: string;
  file: File;
  uploadedUrl?: string;
};

export default function MediaUploader({
  label, 
  maxFiles = 1, 
  accept = "image/*, application/pdf",
  onFilesReady,
  initialUrls = [],
  onRemoveInitialUrl
}: MediaUploaderProps) {
  const [newFiles, setNewFiles] = useState<{ id: string; url: string; type: string; name: string; file: File; uploadedUrl?: string }[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { confirm } = useConfirm(); // ✅ 2. Hook inicializado aqui

  // Descobre se a URL que veio do banco é vídeo ou imagem
  const getMediaType = (url: string) => {
    if (url.includes('.mp4') || url.includes('.webm')) return 'video';
    return 'image';
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const selectedFiles = Array.from(e.target.files);
    const totalCurrent = initialUrls.length + newFiles.length;

    if (totalCurrent + selectedFiles.length > maxFiles) {
      await confirm({
        title: "Limite atingido",
        subtitle: `Você só pode ter até ${maxFiles} arquivo(s) no total.`,
        tone: "amber",
        confirmText: "Entendi",
        cancelText: "Voltar"
      });
      return;
    }

    setIsCompressing(true);
    const addedPreviews: { id: string; url: string; type: string; name: string; file: File; uploadedUrl?: string }[] = [];

    for (const file of selectedFiles) {
      if (file.type.startsWith("video/")) {
        // ✅ Limite generoso (50MB) só como proteção extrema — o R2 aguenta bem mais
        if (file.size > 10 * 1024 * 1024) {
          await confirm({
            title: "Vídeo muito grande",
            subtitle: `O vídeo "${file.name}" tem ${(file.size / 1024 / 1024).toFixed(1)}MB. O limite máximo é 50MB.`,
            tone: "rose",
            confirmText: "Entendi",
            cancelText: "Voltar"
          });
          continue;
        }

        // ✅ Upload direto para o R2 via presigned URL (ignora o Next.js/Vercel)
        try {
          const presignRes = await fetch("/api/upload/presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              contentType: file.type,
              folder: "tenants/branding/banners",
            }),
          });

          if (!presignRes.ok) throw new Error("Falha ao obter URL de upload.");
          const { presignedUrl, publicUrl } = await presignRes.json();

          // ✅ PUT direto no R2 — sem passar pelo Next.js
          const uploadRes = await fetch(presignedUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file,
          });

          if (!uploadRes.ok) throw new Error("Falha ao enviar vídeo para a nuvem.");

          addedPreviews.push({
            id: Math.random().toString(),
            url: URL.createObjectURL(file), // preview local
            type: "video",
            name: file.name,
            file, // mantido por compatibilidade, mas o pai deve usar uploadedUrl
            uploadedUrl: publicUrl, // ✅ URL pública já no R2
          });
        } catch (err: any) {
          await confirm({
            title: "Erro no upload do vídeo",
            subtitle: err.message || "Não foi possível enviar o vídeo.",
            tone: "rose",
            confirmText: "Entendi",
            cancelText: "Voltar"
          });
        }
      } else if (file.type.startsWith("image/")) {
        try {
          const options = { maxSizeMB: 0.3, maxWidthOrHeight: 1920, useWebWorker: true, fileType: "image/webp" };
          const compressedBlob = await imageCompression(file, options);
          const compressedFile = new File([compressedBlob], file.name.replace(/\.[^/.]+$/, "") + ".webp", { type: "image/webp" });
          addedPreviews.push({
            id: Math.random().toString(),
            url: URL.createObjectURL(compressedFile),
            type: "image",
            name: compressedFile.name,
            file: compressedFile,
          });
        } catch (error) {
          console.error("Erro na compressão", error);
        }
      } else {
        if (file.size > 10 * 1024 * 1024) {
          await confirm({
            title: "Arquivo muito grande",
            subtitle: `O documento "${file.name}" é muito grande. O limite é 10MB.`,
            tone: "rose",
            confirmText: "Entendi",
            cancelText: "Voltar"
          });
          continue;
        }
        addedPreviews.push({ id: Math.random().toString(), url: "", type: "document", name: file.name, file });
      }
    }

    const updatedNewFiles = [...newFiles, ...addedPreviews];
    setNewFiles(updatedNewFiles);
    // ✅ Passa os files + as URLs já enviadas (vídeos) para o componente pai
    onFilesReady(updatedNewFiles.map(p => p.file), updatedNewFiles.map(p => p.uploadedUrl));
    setIsCompressing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeNewFile = (idToRemove: string) => {
    const updatedNewFiles = newFiles.filter(p => p.id !== idToRemove);
    setNewFiles(updatedNewFiles);
    onFilesReady(updatedNewFiles.map(p => p.file));
  };

  const totalCount = initialUrls.length + newFiles.length;

  return (
    <div className="space-y-3">
      <label className="block text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-tight">
        {label}
      </label>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        
        {/* 1️⃣ Renderiza os arquivos que JÁ ESTÃO SALVOS no banco */}
        {initialUrls.map((url, idx) => {
           const type = getMediaType(url);
           return (
            <div key={`saved-${idx}`} className="relative group rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-black aspect-video flex items-center justify-center">
              {type === "image" ? (
                <img src={url} alt="Salvo" className="object-cover w-full h-full opacity-90 group-hover:opacity-100 transition-opacity bg-white" />
              ) : (
                <video src={url} className="object-cover w-full h-full" muted playsInline />
              )}
              <button 
                type="button" 
                onClick={(e) => { e.stopPropagation(); onRemoveInitialUrl?.(url); }}
                className="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600 font-bold text-xs z-10"
                title="Remover arquivo salvo"
              >✕</button>
            </div>
           );
        })}

        {/* 2️⃣ Renderiza os arquivos NOVOS */}
        {newFiles.map(preview => (
          <div key={preview.id} className="relative group rounded-xl overflow-hidden border-2 border-emerald-500/50 bg-slate-100 dark:bg-black aspect-video flex items-center justify-center">
            {preview.type === "image" && <img src={preview.url} alt="Preview" className="object-cover w-full h-full opacity-90 group-hover:opacity-100 transition-opacity" />}
            {preview.type === "video" && <video src={preview.url} className="object-cover w-full h-full" muted playsInline />}
            {preview.type === "document" && <span className="text-[10px] font-medium">{preview.name}</span>}
            <button 
              type="button" 
              onClick={(e) => { e.stopPropagation(); removeNewFile(preview.id); }}
              className="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600 font-bold text-xs z-10"
              title="Remover arquivo novo"
            >✕</button>
          </div>
        ))}

        {/* 3️⃣ Botão Adicionar MAIS */}
        {totalCount < maxFiles && (
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={`aspect-video border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors ${
              isCompressing 
                ? "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-500/5 cursor-wait" 
                : "border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-black/20 hover:border-emerald-500/50 hover:bg-emerald-50 dark:hover:bg-emerald-500/5"
            }`}
          >
            {isCompressing ? (
              <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
                <svg className="animate-spin w-4 h-4 mb-1" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                <span className="text-[9px] font-bold">Processando...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 opacity-60 group-hover:opacity-100 text-slate-500 dark:text-white/60">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span className="text-[10px] font-bold">Adicionar</span>
              </div>
            )}
            <input type="file" ref={fileInputRef} className="hidden" accept={accept} multiple={maxFiles - totalCount > 1} onChange={handleFileChange} disabled={isCompressing} />
          </div>
        )}
      </div>
      
      {maxFiles > 1 && (
        <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
          <span>{totalCount} de {maxFiles} arquivos em uso</span>
        </div>
      )}
    </div>
  );
}
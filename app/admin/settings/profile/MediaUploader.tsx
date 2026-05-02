"use client";

import { useState, useRef } from "react";
import imageCompression from "browser-image-compression";

interface MediaUploaderProps {
  label: string;
  maxFiles?: number;
  accept?: string;
  onFilesReady: (files: File[]) => void;
}

export default function MediaUploader({ 
  label, 
  maxFiles = 1, 
  accept = "image/*, application/pdf", // Aceita imagens e pdf por padrão
  onFilesReady 
}: MediaUploaderProps) {
  // ✅ CORREÇÃO: O state agora guarda o arquivo real (File) para podermos avisar o pai corretamente quando for apagado
  const [previews, setPreviews] = useState<{ id: string; url: string; type: string; name: string; file: File }[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const selectedFiles = Array.from(e.target.files);
    
    // 1. Limite de quantidade
    if (previews.length + selectedFiles.length > maxFiles) {
      alert(`Você só pode enviar até ${maxFiles} arquivo(s).`);
      return;
    }

    setIsCompressing(true);
    const newPreviews: { id: string; url: string; type: string; name: string; file: File }[] = [];

    for (const file of selectedFiles) {
      // 2. Lógica para Vídeos
      if (file.type.startsWith("video/")) {
        if (file.size > 10 * 1024 * 1024) { // 10MB
          alert(`O vídeo ${file.name} é muito grande. O limite é 10MB.`);
          continue;
        }
        newPreviews.push({ id: Math.random().toString(), url: URL.createObjectURL(file), type: "video", name: file.name, file: file });
      } 
      // 3. Lógica para Imagens (Compressão Mágica)
      else if (file.type.startsWith("image/")) {
        try {
          const options = {
            maxSizeMB: 0.3, 
            maxWidthOrHeight: 1920, 
            useWebWorker: true,
            fileType: "image/webp" 
          };
          
          const compressedBlob = await imageCompression(file, options);
          const compressedFile = new File([compressedBlob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
            type: "image/webp",
          });

          newPreviews.push({ id: Math.random().toString(), url: URL.createObjectURL(compressedFile), type: "image", name: compressedFile.name, file: compressedFile });
        } catch (error) {
          console.error("Erro ao comprimir imagem", error);
        }
      }
      // 4. Lógica para Documentos (PDF, Word, Excel, etc)
      else {
        if (file.size > 5 * 1024 * 1024) { // 5MB para docs
          alert(`O documento ${file.name} é muito grande. O limite é 5MB.`);
          continue;
        }
        // Arquivos não-visuais não geram objectURL para preview visual direto, usamos um ícone
        newPreviews.push({ id: Math.random().toString(), url: "", type: "document", name: file.name, file: file });
      }
    }

    // ✅ CORREÇÃO: Atualiza a lista interna e já manda a lista real de arquivos (File) para a página principal
    const updatedPreviews = [...previews, ...newPreviews];
    setPreviews(updatedPreviews);
    onFilesReady(updatedPreviews.map(p => p.file)); 
    
    setIsCompressing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idToRemove: string) => {
    // ✅ CORREÇÃO: Remove o arquivo da lista e avisa a página principal da remoção
    const updatedPreviews = previews.filter(p => p.id !== idToRemove);
    setPreviews(updatedPreviews);
    onFilesReady(updatedPreviews.map(p => p.file));
  };

  return (
    <div className="space-y-3">
      <label className="block text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-tight">
        {label}
      </label>
      
      {/* Container Unificado em Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        
        {/* Renderiza as miniaturas existentes no grid */}
        {previews.map(preview => (
          <div key={preview.id} className="relative group rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-black aspect-video flex items-center justify-center">
            
            {/* Renderização Condicional por Tipo */}
            {preview.type === "image" && (
              <img src={preview.url} alt="Preview" className="object-cover w-full h-full opacity-90 group-hover:opacity-100 transition-opacity" />
            )}
            
            {preview.type === "video" && (
              <video src={preview.url} className="object-cover w-full h-full" muted playsInline />
            )}

            {preview.type === "document" && (
              <div className="flex flex-col items-center justify-center w-full h-full p-2 text-slate-500 dark:text-white/60">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-1 text-sky-500">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                </svg>
                <span className="text-[10px] font-medium truncate w-full text-center px-2" title={preview.name}>
                  {preview.name}
                </span>
              </div>
            )}
            
            {/* Botão de Excluir */}
            <button 
              type="button" 
              onClick={(e) => { e.stopPropagation(); removeFile(preview.id); }}
              className="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600 font-bold text-xs z-10"
            >
              ✕
            </button>
          </div>
        ))}

        {/* Botão para Adicionar MAIS (Sempre o último item do grid se houver limite disponível) */}
        {previews.length < maxFiles && (
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
                <span className="text-[9px] font-bold text-center leading-tight">Processando...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 opacity-60 group-hover:opacity-100 text-slate-500 dark:text-white/60">
                {/* Ícone de MAIS em vez de upload */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                {/* Mostra quantos arquivos ainda pode mandar */}
                <span className="text-[10px] font-bold text-center px-1">Adicionar</span>
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept={accept} 
              multiple={maxFiles > 1}
              onChange={handleFileChange}
              disabled={isCompressing}
            />
          </div>
        )}
      </div>
      
      {/* Texto de limite atualizado, discreto no rodapé do componente */}
      {maxFiles > 1 && (
        <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
          <span>{previews.length} de {maxFiles} arquivos selecionados</span>
        </div>
      )}
    </div>
  );
}
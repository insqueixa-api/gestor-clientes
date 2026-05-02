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
  // Adicionamos 'name' para poder exibir o nome do documento
  const [previews, setPreviews] = useState<{ id: string; url: string; type: string; name: string }[]>([]);
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
    const processedFiles: File[] = [];
    const newPreviews: { id: string; url: string; type: string; name: string }[] = [];

    for (const file of selectedFiles) {
      // 2. Lógica para Vídeos
      if (file.type.startsWith("video/")) {
        if (file.size > 10 * 1024 * 1024) { // 10MB
          alert(`O vídeo ${file.name} é muito grande. O limite é 10MB.`);
          continue;
        }
        processedFiles.push(file);
        newPreviews.push({ id: Math.random().toString(), url: URL.createObjectURL(file), type: "video", name: file.name });
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

          processedFiles.push(compressedFile);
          newPreviews.push({ id: Math.random().toString(), url: URL.createObjectURL(compressedFile), type: "image", name: compressedFile.name });
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
        processedFiles.push(file);
        // Arquivos não-visuais não geram objectURL para preview visual direto, usamos um ícone
        newPreviews.push({ id: Math.random().toString(), url: "", type: "document", name: file.name });
      }
    }

    setPreviews(prev => [...prev, ...newPreviews]);
    onFilesReady(processedFiles); 
    setIsCompressing(false);
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idToRemove: string) => {
    setPreviews(prev => prev.filter(p => p.id !== idToRemove));
  };

  return (
    <div className="space-y-3">
      <label className="block text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-tight">
        {label}
      </label>
      
      {/* Área de Drop / Clique */}
      {previews.length < maxFiles && (
        <div 
          onClick={() => fileInputRef.current?.click()}
          className={`w-full h-24 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors ${
            isCompressing 
              ? "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-500/5" 
              : "border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-black/20 hover:border-emerald-500/50 hover:bg-emerald-50 dark:hover:bg-emerald-500/5"
          }`}
        >
          {isCompressing ? (
            <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
              <svg className="animate-spin w-5 h-5 mb-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              <span className="text-xs font-bold">Processando arquivos...</span>
            </div>
          ) : (
            <>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 mb-2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span className="text-xs font-medium text-slate-500 dark:text-white/50">Clique para enviar ({maxFiles - previews.length} restante)</span>
            </>
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

      {/* Grid de Previews */}
      {previews.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
          {previews.map(preview => (
            <div key={preview.id} className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-black aspect-video flex items-center justify-center">
              
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
                onClick={(e) => { e.stopPropagation(); removeFile(preview.id); }}
                className="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600 font-bold text-xs z-10"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
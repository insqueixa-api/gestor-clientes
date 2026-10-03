// lib/r2-upload.ts
import { useRef } from "react";
import { R2_PUBLIC_CACHE_CONTROL } from "@/lib/r2-folders";
//
// Upload pro R2 (presign → PUT direto) + liberação dos arquivos que
// deixaram de ser usados. Criado 30/09/2026 (achado do Márcio: trocar logo
// de servidor nunca apagava a anterior no R2, só acumulava; excluir Edição
// deixava o PDF órfão).
//
// Regra pra quem usa:
// - arquivo que o banco JÁ referencia só é liberado DEPOIS que o save que
//   troca/remove a referência deu certo;
// - upload feito e descartado antes de salvar (trocou de novo, cancelou o
//   modal) pode ser liberado na hora.
// A rota DELETE /api/upload só apaga se nenhuma linha do banco usar mais a
// URL (r2_url_in_use) — então liberar algo ainda usado em outro lugar é
// inofensivo: o arquivo fica.

async function presignAndPut(
  body: Blob,
  fileName: string,
  contentType: string,
  folder: string,
  withCache: boolean,
): Promise<string> {
  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, contentType, folder, noCache: !withCache }),
  });
  const { presignedUrl, publicUrl } = await presignRes.json().catch(() => ({}));
  if (!presignRes.ok || !presignedUrl || !publicUrl) {
    throw new Error("Falha ao preparar o envio do arquivo.");
  }

  const putRes = await fetch(presignedUrl, {
    method: "PUT",
    body,
    // tem que bater com o CacheControl assinado em /api/upload/presign
    headers: withCache
      ? { "Content-Type": contentType, "Cache-Control": R2_PUBLIC_CACHE_CONTROL }
      : { "Content-Type": contentType },
  });
  if (!putRes.ok) throw new Error("Falha ao enviar o arquivo.");

  return publicUrl as string;
}

export async function uploadToR2(
  body: Blob,
  fileName: string,
  contentType: string,
  folder: string,
): Promise<string> {
  // ✅ 03/10/2026, decisão do Márcio ("tira o cache, eu tenho que poder
  // alterar"): upload do navegador vai SEM cabeçalho de cache. O CORS do
  // bucket não aceita "cache-control" e todo upload dava "Failed to fetch"
  // desde 02/10. Uploads feitos pelo servidor (lib/r2-server.ts) seguem com
  // cache — não passam por CORS.
  return presignAndPut(body, fileName, contentType, folder, false);
}

// Best-effort, nunca lança: falha aqui só deixa um arquivo órfão no R2,
// nunca pode travar o fluxo de quem chamou.
export function releaseR2Files(urls: Array<string | null | undefined>): void {
  const list = [...new Set(urls.filter((u): u is string => !!u && u.trim() !== ""))];
  if (list.length === 0) return;
  fetch("/api/upload", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls: list }),
    keepalive: true,
  }).catch(() => {});
}

// Pra formulário/modal com salvar e cancelar (logo de servidor/app/
// condomínio, fotos da Ação):
//   setOriginal(urls)  → o que o banco já tem ao abrir pra editar
//   trackUpload(url)   → a cada upload feito nesta sessão
//   commit(finalUrls)  → DEPOIS do save dar certo: libera o original que
//                        saiu + uploads da sessão que não ficaram
//                        (trocou 2x antes de salvar, removeu a foto...)
//   discard()          → fechou sem salvar: libera só os uploads da sessão
export function useR2FileTracker() {
  const originals = useRef<Set<string>>(new Set());
  const pending = useRef<Set<string>>(new Set());

  return useRef({
    setOriginal(urls: Array<string | null | undefined>) {
      originals.current = new Set(urls.filter((u): u is string => !!u));
    },
    trackUpload(url: string) {
      pending.current.add(url);
    },
    commit(finalUrls: Array<string | null | undefined>) {
      const keep = new Set(finalUrls.filter((u): u is string => !!u));
      releaseR2Files(
        [...originals.current, ...pending.current].filter((u) => !keep.has(u)),
      );
      originals.current = keep;
      pending.current = new Set();
    },
    discard() {
      releaseR2Files([...pending.current].filter((u) => !originals.current.has(u)));
      pending.current = new Set();
    },
  }).current;
}

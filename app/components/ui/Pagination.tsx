"use client";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = [50, 100, 200],
}: PaginationProps) {
  return (
    <div className="border-t border-border px-4 py-3 flex flex-col md:flex-row items-center justify-between gap-3 bg-transparent">
      <div className="w-full md:w-auto flex items-center justify-between md:justify-start gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Mostrar</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="bg-transparent border border-border rounded px-1 py-0.5 outline-none text-foreground/90 cursor-pointer hover:border-emerald-500/50 transition-colors"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        {/* 📱 Mobile: dropdown de páginas — mesma linha, mesma fonte do "Mostrar" */}
        <select
          value={page}
          onChange={(e) => onPageChange(Number(e.target.value))}
          className="md:hidden bg-transparent border border-border rounded px-1 py-0.5 outline-none text-foreground/90 cursor-pointer hover:border-emerald-500/50 transition-colors"
        >
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((pNum) => (
            <option key={pNum} value={pNum}>
              Página {pNum}
            </option>
          ))}
        </select>
      </div>

      {/* 💻 Desktop */}
      <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          Página <span className="font-medium text-foreground/90">{page}</span> / {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1 rounded border border-border text-xs font-medium disabled:opacity-40 bg-card hover:bg-muted text-muted-foreground transition-colors"
          >
            Anterior
          </button>
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border border-border text-xs font-medium disabled:opacity-40 bg-card hover:bg-muted text-muted-foreground transition-colors"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}

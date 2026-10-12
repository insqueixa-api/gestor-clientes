"use client";
// components/ui/TrashButton.tsx — ✅ 12/10/2026
// lixeira no mesmo formato da linha do tempo do cliente (aparece no hover)
export default function TrashButton({ busy, onClick }: { busy?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-500/80 hover:text-rose-500 disabled:opacity-30"
      title="Apagar registro"
    >
      {busy ? (
        <span className="block w-3.5 h-3.5 rounded-full border-2 border-rose-500/30 border-t-rose-500 animate-spin" />
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4h6v2" />
        </svg>
      )}
    </button>
  );
}

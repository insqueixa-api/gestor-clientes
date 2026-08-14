// components/legal/LegalLayout.tsx
import Link from "next/link";

export default function LegalLayout({
  title,
  sinceDate,
  lastUpdated,
  backHref = "/login",
  children,
}: {
  title: string;
  sinceDate: string;
  lastUpdated: string;
  backHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Faixa de topo com a mesma identidade visual das telas de login */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0b2a4a] via-[#0f141a] to-[#0e6b5c] opacity-90 dark:opacity-100" />
          <div className="absolute -top-40 -right-40 h-[420px] w-[420px] rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 h-[420px] w-[420px] rounded-full bg-sky-500/20 blur-3xl" />
        </div>

        <div className="relative z-10 mx-auto max-w-3xl px-5 sm:px-6 pt-8 pb-10 sm:pt-10 sm:pb-12">
          <img
            src="/brand/logo-full-light.png"
            alt="UniGestor"
            className="h-8 sm:h-9 w-auto select-none"
            draggable={false}
          />
          <h1 className="mt-5 text-2xl sm:text-3xl font-semibold text-white">
            {title}
          </h1>
          <p className="mt-1.5 text-sm text-white/70">
            Vigente desde {sinceDate} · Última revisão: {lastUpdated}
          </p>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="mx-auto max-w-3xl px-5 sm:px-6 py-8 sm:py-10">
        <div className="rounded-2xl border border-border bg-card px-5 sm:px-8 py-6 sm:py-8">
          <article
            className="
              text-[15px] leading-relaxed text-foreground
              [&_h2]:text-lg [&_h2]:sm:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-8 [&_h2]:mb-3 first:[&_h2]:mt-0
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-5 [&_h3]:mb-2
              [&_p]:mb-3 [&_p]:text-foreground/85
              [&_ul]:mb-3 [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:text-foreground/85
              [&_li]:leading-relaxed
              [&_strong]:font-semibold [&_strong]:text-foreground
              [&_a]:text-emerald-500 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2
            "
          >
            {children}
          </article>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          <Link
            href={backHref}
            className="text-sm font-medium text-emerald-500 hover:text-emerald-600 transition"
          >
            ← Voltar
          </Link>
          <p className="text-[11px] text-muted-foreground">
            UniGestor © {new Date().getFullYear()} — operado por MARCIO
            MARTINS (MEI), CNPJ 58.024.281/0001-00
          </p>
        </div>
      </div>
    </div>
  );
}

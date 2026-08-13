// app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

// 1. IMPORTANTE: Importe o Provider que você criou
// (Confirme se o caminho está certo, baseado no código que você me mandou antes)
import { ThemeProvider } from "@/components/theme/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#050505", // Cor exata da sua Topbar
};

export const metadata: Metadata = {
  title: "UniGestor",
  description: "Sistema de Gestão",
  icons: {
    // Ao usar o PNG branco aqui, o Chrome fica satisfeito com a resolução e não rouba o azul do manifesto!
    icon: "/brand/icon-192x192blue.png",
    shortcut: "/brand/icon-192x192blue.png",
    apple: "/brand/icon-192x192blue.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 2. IMPORTANTE: suppressHydrationWarning evita erros no console quando o tema carrega
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var storedTheme = localStorage.getItem('app_theme');
                  var theme = storedTheme || 'light';
                  document.documentElement.dataset.theme = theme;
                  if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {}
              })();
            `
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* 3. AQUI ESTÁ A MÁGICA: O Provider precisa "abraçar" todo o site */}
        <ThemeProvider>{children}</ThemeProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}

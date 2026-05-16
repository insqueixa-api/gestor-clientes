import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  manifest: "/manifest.webmanifest", 
  icons: {
    // Ao usar o PNG branco aqui, o Chrome fica satisfeito com a resolução e não rouba o azul do manifesto!
    icon: "/brand/icon-192x192blue.png",      
    shortcut: "/brand/icon-192x192.png",  
    apple: "/brand/icon-192x192blue.png", 
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "UniGestor",
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* 3. AQUI ESTÁ A MÁGICA: O Provider precisa "abraçar" todo o site */}
        <ThemeProvider>
            {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
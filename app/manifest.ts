import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UniGestor",
    short_name: "UniGestor",
    description: "Plataforma de Gestão",
    start_url: "/admin",
    display: "standalone",
    background_color: "#0f141b",
    theme_color: "#050505",
    icons: [
      {
        src: "/brand/icon-192x192blue.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512x512blue.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512x512blue.png",
        sizes: "any",
        purpose: "any",
      },
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      }
    ],
  }
}
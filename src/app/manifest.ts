import type { MetadataRoute } from "next";

/** Lets staff install the site on a phone ("Add to Home Screen") and open it full screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Les Cocotiers — Gestion immobilière",
    short_name: "Cocotiers",
    description: "Biens, locataires, baux, paiements et dépenses.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "fr",
    background_color: "#f7f6f1",
    theme_color: "#456140",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { sidebarInitScript } from "@/components/shell/sidebar-recolhida";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Fonte da marca — usada só no wordmark “Meraki”. */
const brand = Newsreader({
  variable: "--font-newsreader",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Meraki — Estrutura dos sistemas e agentes",
    template: "%s · Meraki",
  },
  description:
    "Meraki lê a estrutura dos seus sistemas (banco, n8n e repositório), aponta o que está errado com evidência e decide o que os agentes de IA podem mudar.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${brand.variable} antialiased`}
      // O script abaixo pode marcar o <html> antes de o React hidratar
      suppressHydrationWarning
    >
      <head>
        {/* Menu lateral recolhido salvo: aplica antes da primeira pintura (sem piscar) */}
        <script dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

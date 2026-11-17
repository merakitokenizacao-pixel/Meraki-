"use client";

import type { DadosShell } from "@/lib/plataforma/modelo";
import { CommandPalette } from "./command-palette";
import { ShellProvider } from "./provider";
import { MobileBar, MobileNav, Sidebar } from "./sidebar";
import { Toaster } from "./toaster";

/**
 * Moldura do console. `dados` chega como promessa do layout (servidor): a navegação aparece na hora
 * e os números do banco entram por streaming, sem segurar a página.
 * Sem barra superior: o título de cada tela abre a página, e a busca segue no Ctrl K.
 * Fundo como na VoraX: o menu lateral fica no chão da página (canvas), sem fundo próprio, e a área de
 * trabalho é o campo, um tom acima.
 */
export function AppShell({ dados, children }: { dados: Promise<DadosShell>; children: React.ReactNode }) {
  return (
    <ShellProvider>
      <div className="flex h-dvh overflow-hidden bg-canvas">
        <Sidebar dados={dados} />
        <div className="flex min-w-0 flex-1 flex-col bg-campo">
          <MobileBar />
          <div id="conteudo" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            <main className="@container mx-auto w-full max-w-[1400px] px-4 pt-4 pb-16 sm:px-8 lg:pt-8">{children}</main>
          </div>
        </div>
      </div>
      <MobileNav dados={dados} />
      <CommandPalette dados={dados} />
      <Toaster />
    </ShellProvider>
  );
}

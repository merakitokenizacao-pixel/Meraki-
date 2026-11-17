"use client";

import { CommandPalette } from "./command-palette";
import { Copilot } from "./copilot";
import { ShellProvider } from "./provider";
import { MobileNav, Sidebar } from "./sidebar";
import { Toaster } from "./toaster";
import { Topbar } from "./topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <div className="flex h-dvh overflow-hidden bg-canvas">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <div id="conteudo" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            <main className="@container mx-auto w-full max-w-[1400px] px-4 pt-8 pb-16 sm:px-8">{children}</main>
          </div>
        </div>
      </div>
      <MobileNav />
      <CommandPalette />
      <Copilot />
      <Toaster />
    </ShellProvider>
  );
}

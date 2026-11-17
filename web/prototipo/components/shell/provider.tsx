"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RangeKey } from "@/lib/time";

export type Env = "prod" | "staging" | "all";
export type ToastTone = "ok" | "info" | "warn";
export type Toast = { id: number; title: string; description?: string; tone: ToastTone };

type ShellState = {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  env: Env;
  setEnv: (e: Env) => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  copilotOpen: boolean;
  /** pergunta enviada ao abrir o Copilot (nonce muda a cada pedido) */
  copilotAsk: { text: string; nonce: number } | null;
  openCopilot: (ask?: string) => void;
  closeCopilot: () => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (o: boolean) => void;
  toasts: Toast[];
  toast: (t: { title: string; description?: string; tone?: ToastTone }) => void;
  dismissToast: (id: number) => void;
};

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [range, setRange] = useState<RangeKey>("24h");
  const [env, setEnv] = useState<Env>("prod");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotAsk, setCopilotAsk] = useState<{ text: string; nonce: number } | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    ({ title, description, tone = "ok" }: { title: string; description?: string; tone?: ToastTone }) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-2), { id, title, description, tone }]);
      window.setTimeout(() => dismissToast(id), 4200);
    },
    [dismissToast],
  );

  const openCopilot = useCallback((ask?: string) => {
    setPaletteOpen(false);
    setCopilotOpen(true);
    if (ask) setCopilotAsk({ text: ask, nonce: ++seq.current });
  }, []);

  const closeCopilot = useCallback(() => setCopilotOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<ShellState>(
    () => ({
      range,
      setRange,
      env,
      setEnv,
      paletteOpen,
      setPaletteOpen,
      copilotOpen,
      copilotAsk,
      openCopilot,
      closeCopilot,
      mobileNavOpen,
      setMobileNavOpen,
      toasts,
      toast,
      dismissToast,
    }),
    [range, env, paletteOpen, copilotOpen, copilotAsk, openCopilot, closeCopilot, mobileNavOpen, toasts, toast, dismissToast],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell precisa estar dentro de <ShellProvider>");
  return ctx;
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ToastTone = "ok" | "info" | "warn";
export type Toast = { id: number; title: string; description?: string; tone: ToastTone };

type ShellState = {
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (o: boolean) => void;
  toasts: Toast[];
  toast: (t: { title: string; description?: string; tone?: ToastTone }) => void;
  dismissToast: (id: number) => void;
};

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    ({ title, description, tone = "ok" }: { title: string; description?: string; tone?: ToastTone }) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-2), { id, title, description, tone }]);
      window.setTimeout(() => dismissToast(id), 5200);
    },
    [dismissToast],
  );

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
    () => ({ paletteOpen, setPaletteOpen, mobileNavOpen, setMobileNavOpen, toasts, toast, dismissToast }),
    [paletteOpen, mobileNavOpen, toasts, toast, dismissToast],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell precisa estar dentro de <ShellProvider>");
  return ctx;
}

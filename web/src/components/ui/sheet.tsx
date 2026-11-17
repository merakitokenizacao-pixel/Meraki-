"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

/** Painel lateral ancorado à direita, renderizado em portal no <body>. */
export function Sheet({
  open,
  onClose,
  children,
  width = 600,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  label: string;
}) {
  const mounted = useMounted();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn("fixed inset-0 z-40 bg-black/55 transition-opacity duration-300", open ? "opacity-100" : "pointer-events-none opacity-0")}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex flex-col overflow-hidden border-l border-line-2 bg-surface shadow-pop transition-transform duration-300 ease-[cubic-bezier(.2,.7,.2,1)]",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{ width: `min(${width}px, 100vw)` }}
      >
        {children}
      </aside>
    </>,
    document.body,
  );
}

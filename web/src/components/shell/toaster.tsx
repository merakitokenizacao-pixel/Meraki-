"use client";

import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShell } from "./provider";

const TONE = {
  ok: { icon: CircleCheck, className: "text-ok-ink" },
  info: { icon: Info, className: "text-accent-ink" },
  warn: { icon: TriangleAlert, className: "text-warn-ink" },
};

export function Toaster() {
  const { toasts, dismissToast } = useShell();
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
      {toasts.map((t) => {
        const { icon: Icon, className } = TONE[t.tone];
        return (
          <div key={t.id} className="pointer-events-auto flex animate-enter items-start gap-3 rounded-[7px] border border-line-2 bg-raised px-3.5 py-3 shadow-pop">
            <Icon className={cn("mt-px size-[18px] shrink-0", className)} strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ink">{t.title}</div>
              {t.description && <div className="mt-0.5 text-[12px] leading-snug text-ink-3">{t.description}</div>}
            </div>
            <button
              type="button"
              aria-label="Fechar"
              onClick={() => dismissToast(t.id)}
              className="-mt-0.5 -mr-1 grid size-6 place-items-center rounded-[6px] text-ink-3 hover:bg-white/[0.06] hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

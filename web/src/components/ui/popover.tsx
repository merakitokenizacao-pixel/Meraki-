"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn, normalize } from "@/lib/utils";

/** Popover leve: fecha com clique fora, Esc e quando a rota é ocultada pelo Activity. */
export function Popover({
  trigger,
  children,
  align = "start",
  className,
  width,
}: {
  trigger: (s: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode | ((s: { close: () => void }) => React.ReactNode);
  align?: "start" | "end";
  className?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Rotas ocultadas pelo <Activity> não devem reaparecer com o popover aberto.
  useLayoutEffect(() => () => setOpen(false), []);

  const close = () => setOpen(false);

  return (
    <div ref={ref} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={cn(
            "absolute top-full z-50 mt-1.5 animate-pop rounded-[7px] border border-line-2 bg-raised p-1 shadow-pop",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            className,
          )}
          style={{ width }}
        >
          {typeof children === "function" ? children({ close }) : children}
        </div>
      )}
    </div>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pt-2 pb-1.5 text-[11.5px] font-medium text-ink-3">{children}</div>;
}

export function MenuItem({
  children,
  selected,
  onClick,
  icon,
  hint,
}: {
  children: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-muted"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[11.5px] text-ink-3">{hint}</span>}
      <Check className={cn("size-4 text-ink", selected ? "opacity-100" : "opacity-0")} strokeWidth={2.25} />
    </button>
  );
}

/** Filtro de dimensão em formato de chip com seleção múltipla. */
export function MultiSelectChip({
  label,
  options,
  value,
  onChange,
  searchable,
}: {
  label: string;
  options: { value: string; label: string; marker?: string; count?: number }[];
  value: string[];
  onChange: (v: string[]) => void;
  searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const filtered = q ? options.filter((o) => normalize(o.label).includes(normalize(q))) : options;
  const active = value.length > 0;

  return (
    <Popover
      width={248}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px] transition-colors",
            active ? "border-ink-4 bg-muted text-ink" : "border-dashed border-line-2 text-ink-2 hover:border-ink-4 hover:text-ink",
            open && !active && "border-ink-4 text-ink",
          )}
        >
          <span className={cn(active && "text-ink-3")}>{label}</span>
          {active && (
            <span className="max-w-[140px] truncate font-medium">
              {selectedLabels.length > 2 ? `${selectedLabels.length} selecionados` : selectedLabels.join(", ")}
            </span>
          )}
          {active ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Limpar filtro ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  onChange([]);
                }
              }}
              className="-mr-1 grid size-5 place-items-center rounded-[5px] text-ink-3 hover:bg-white/10 hover:text-ink"
            >
              <X className="size-3" />
            </span>
          ) : (
            <ChevronDown className="size-3.5 opacity-60" />
          )}
        </button>
      )}
    >
      {searchable && (
        <div className="flex items-center gap-2 border-b border-line-2 px-2.5 pt-1.5 pb-2">
          <Search className="size-3.5 text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Buscar ${label.toLowerCase()}…`}
            className="w-full bg-transparent text-[13px] text-ink outline-none"
          />
        </div>
      )}
      <div className="max-h-[280px] overflow-y-auto py-1 scrollbar-thin">
        {filtered.map((o) => {
          const sel = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(sel ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-muted"
            >
              <span
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
                  sel ? "border-ink bg-ink text-on-ink" : "border-line-2 bg-sunken",
                )}
              >
                {sel && <Check className="size-3" strokeWidth={3} />}
              </span>
              {o.marker && <span className="size-2 shrink-0 rounded-full" style={{ background: o.marker }} />}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.count !== undefined && <span className="text-[11.5px] text-ink-3 tnum">{o.count}</span>}
            </button>
          );
        })}
        {!filtered.length && <div className="px-3 py-4 text-center text-[12.5px] text-ink-3">Nada encontrado</div>}
      </div>
      {active && (
        <div className="border-t border-line-2 px-1 pt-1">
          <button type="button" onClick={() => onChange([])} className="w-full rounded-[7px] px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-muted">
            Limpar seleção
          </button>
        </div>
      )}
    </Popover>
  );
}

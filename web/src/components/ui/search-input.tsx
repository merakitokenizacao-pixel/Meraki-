"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-8 items-center gap-2 rounded-[8px] border border-line-2 bg-sunken px-2.5 text-[13px] transition-colors focus-within:border-ink-4",
        className,
      )}
    >
      <Search className="size-3.5 shrink-0 text-ink-3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-4"
      />
      {value && (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => onChange("")}
          className="-mr-1 grid size-5 place-items-center rounded-[5px] text-ink-3 hover:bg-white/10 hover:text-ink"
        >
          <X className="size-3" />
        </button>
      )}
    </label>
  );
}

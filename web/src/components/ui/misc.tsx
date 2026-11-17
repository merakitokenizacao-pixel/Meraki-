import { type ProjetoRef, corProjeto } from "@/lib/plataforma/modelo";
import { cn, hash, initials } from "@/lib/utils";

const AVATAR_TONES = ["#2c2c33", "#34343c", "#283340", "#352d3d", "#2d3830", "#3b3229"];

export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const bg = AVATAR_TONES[hash(name) % AVATAR_TONES.length];
  return (
    <span
      title={name}
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-medium text-ink-2 ring-1 ring-white/5 select-none", className)}
      style={{ width: size, height: size, background: bg, fontSize: Math.max(9, size * 0.38) }}
    >
      {initials(name)}
    </span>
  );
}

/** Projeto: ponto na cor fixa do projeto + nome. A cor segue o projeto, nunca a posição. */
export function ProjectTag({ projeto, className, muted }: { projeto: ProjetoRef; className?: string; muted?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[12.5px] whitespace-nowrap", muted ? "text-ink-3" : "text-ink-2", className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: corProjeto(projeto.cor) }} />
      <span className="truncate">{projeto.nome}</span>
    </span>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line-2 bg-muted px-1 font-sans text-[10.5px] leading-none text-ink-3",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Mono({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("font-mono text-[12px] text-ink-2", className)}>
      {children}
    </span>
  );
}

/** Rótulo neutro em pílula (tipo, regra, origem). */
export function Pill({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-line-2 bg-raised px-2 text-[11.5px] font-medium whitespace-nowrap text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 grid size-10 place-items-center rounded-[7px] border border-line bg-subtle text-ink-3">{icon}</div>}
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {description && <p className="max-w-sm text-[13px] text-ink-3">{description}</p>}
    </div>
  );
}

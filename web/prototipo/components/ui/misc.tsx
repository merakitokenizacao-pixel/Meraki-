import { PEOPLE } from "@/lib/data/people";
import { projectById } from "@/lib/data/projects";
import { hash } from "@/lib/series";
import { cn, initials } from "@/lib/utils";

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

export function PersonChip({ id, className }: { id: string; className?: string }) {
  const p = PEOPLE[id];
  if (!p) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] text-ink-2", className)}>
      <Avatar name={p.name} size={18} />
      {p.name}
    </span>
  );
}

export function ProjectTag({ id, className, muted }: { id: string; className?: string; muted?: boolean }) {
  const p = projectById(id);
  if (!p) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap", muted ? "text-ink-3" : "text-ink-2", className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
      {p.name}
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

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px] text-ink-2", className)}>{children}</span>;
}

/** Identificador visual do agente: inicial em um quadrado arredondado + ponto da cor do projeto. */
export function AgentGlyph({ name, project, size = 32, className }: { name: string; project: string; size?: number; className?: string }) {
  const p = projectById(project);
  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center rounded-[9px] border border-line-2 bg-muted font-medium text-ink", className)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {name.replace(/[^A-Za-zÀ-ú]/g, "").slice(0, 1)}
      <span
        className="absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-surface"
        style={{ width: Math.max(7, size * 0.24), height: Math.max(7, size * 0.24), background: p?.color }}
      />
    </span>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 grid size-10 place-items-center rounded-[10px] border border-line bg-subtle text-ink-3">{icon}</div>}
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {description && <p className="max-w-sm text-[13px] text-ink-3">{description}</p>}
    </div>
  );
}

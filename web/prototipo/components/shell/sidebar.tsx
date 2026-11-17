"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { ChevronRight, Layers, Settings, X } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { ME } from "@/lib/data/people";
import { PROJECTS } from "@/lib/data/projects";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import {
  ALL_PROJECTS_HREF,
  PRIMARY_NAV,
  PROJECT_PARTS,
  activeProject,
  allProjectsPart,
  attentionCount,
  isActive,
  projectHref,
  type ProjectPart,
} from "./nav";
import { useShell } from "./provider";

const itemClass = (active: boolean) =>
  cn(
    "group flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[13.5px] transition-colors duration-150",
    active ? "bg-white/[0.07] text-ink" : "text-ink-2 hover:bg-white/[0.035] hover:text-ink",
  );

function Count({ n, title }: { n: number; title: string }) {
  if (!n) return null;
  return (
    <span className="text-[12px] text-ink-3 tnum" title={title}>
      {n}
    </span>
  );
}

/**
 * Linha de projeto: ao clicar, abre o projeto e revela as duas partes —
 * Sistemas e Agentes. Só o projeto ativo fica expandido.
 */
function ProjectRow({
  label,
  marker,
  href,
  hrefs,
  project,
  open,
  activePart,
  onNavigate,
}: {
  label: string;
  marker: React.ReactNode;
  href: string;
  hrefs: Record<ProjectPart, string>;
  project?: string;
  open: boolean;
  activePart: ProjectPart | null;
  onNavigate?: () => void;
}) {
  const total = attentionCount(project, "sistemas") + attentionCount(project, "agentes");
  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        aria-expanded={open}
        className={cn(
          "group flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[13.5px] transition-colors duration-150",
          open ? "text-ink" : "text-ink-2 hover:bg-white/[0.035] hover:text-ink",
        )}
      >
        <span className="grid size-4 shrink-0 place-items-center">{marker}</span>
        <span className="flex-1 truncate">{label}</span>
        {!open && <Count n={total} title={`${total} itens precisam de atenção`} />}
        <ChevronRight className={cn("size-3.5 shrink-0 text-ink-4 transition-transform duration-200", open && "rotate-90 text-ink-3")} strokeWidth={2} />
      </Link>
      {open && (
        <ul className="mt-0.5 mb-1.5 ml-[17px] space-y-0.5 border-l border-line pl-2 animate-fade">
          {PROJECT_PARTS.map((part) => {
            const active = activePart === part.key;
            const Icon = part.icon;
            const n = attentionCount(project, part.key);
            return (
              <li key={part.key}>
                <Link
                  href={hrefs[part.key]}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex h-7 items-center gap-2 rounded-[6px] px-2 text-[13px] transition-colors duration-150",
                    active ? "bg-white/[0.07] text-ink" : "text-ink-3 hover:bg-white/[0.035] hover:text-ink",
                  )}
                >
                  <Icon className={cn("size-3.5 shrink-0", active ? "text-ink-2" : "text-ink-4 group-hover:text-ink-3")} strokeWidth={1.75} />
                  <span className="flex-1 truncate">{part.label}</span>
                  <Count n={n} title={part.key === "sistemas" ? `${n} recursos com alerta` : `${n} agentes fora da meta`} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const current = activeProject(pathname);
  const allPart = allProjectsPart(pathname);
  return (
    <nav className="space-y-6">
      <ul className="space-y-0.5">
        {PRIMARY_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={itemClass(active)}>
                <Icon className={cn("size-4 shrink-0", active ? "text-ink" : "text-ink-3 group-hover:text-ink-2")} strokeWidth={1.75} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge !== undefined && (
                  <span className="grid h-[18px] min-w-[20px] place-items-center rounded-full bg-crit-soft px-1.5 text-[11px] font-medium text-crit-ink tnum">
                    {item.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div>
        <div className="mb-1.5 px-2.5 text-[11.5px] font-medium text-ink-3">Projetos</div>
        <ul className="space-y-0.5">
          <ProjectRow
            label="Todos os projetos"
            marker={<Layers className="size-3.5 text-ink-3" strokeWidth={1.75} />}
            href={ALL_PROJECTS_HREF.sistemas}
            hrefs={ALL_PROJECTS_HREF}
            open={allPart !== null}
            activePart={allPart}
            onNavigate={onNavigate}
          />
          {PROJECTS.map((p) => (
            <ProjectRow
              key={p.id}
              label={p.name}
              marker={<span className="size-2 rounded-full" style={{ background: p.color }} />}
              href={projectHref(p.id)}
              hrefs={{ sistemas: projectHref(p.id), agentes: projectHref(p.id, "agentes") }}
              project={p.id}
              open={current?.id === p.id}
              activePart={current?.id === p.id ? current.part : null}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </div>
    </nav>
  );
}

function NavWithPath({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <NavLinks pathname={pathname} onNavigate={onNavigate} />;
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { toast } = useShell();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-line px-5">
        <Link href="/" onClick={onNavigate} aria-label="Meraki — visão geral" className="-mb-0.5 rounded-[4px]">
          <Logo />
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 no-scrollbar">
        <Suspense fallback={<NavLinks pathname="" />}>
          <NavWithPath onNavigate={onNavigate} />
        </Suspense>
      </div>
      <div className="shrink-0 border-t border-line px-3 py-3">
        <div className="mb-2 flex items-center gap-2 px-2.5 text-[12px] text-ink-3">
          <span className="size-1.5 animate-breathe rounded-full bg-ok" />
          Coleta ativa · 41 integrações
        </div>
        <div className="flex items-center gap-2.5 rounded-[8px] px-1.5 py-1">
          <Avatar name={ME.name} size={28} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium text-ink">{ME.name}</div>
            <div className="truncate text-[11.5px] text-ink-3">Engenharia de {ME.role}</div>
          </div>
          <button
            type="button"
            aria-label="Configurações"
            onClick={() => toast({ title: "Configurações", description: "Disponível na versão conectada do Meraki.", tone: "info" })}
            className="grid size-7 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink"
          >
            <Settings className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-[240px] shrink-0 border-r border-line lg:block">
      <SidebarContent />
    </aside>
  );
}

export function MobileNav() {
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  return (
    <div className="lg:hidden">
      <div
        aria-hidden
        onClick={() => setMobileNavOpen(false)}
        className={cn("fixed inset-0 z-40 bg-black/60 transition-opacity duration-300", mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0")}
      />
      <aside
        inert={!mobileNavOpen}
        aria-label="Navegação"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[264px] border-r border-line-2 bg-canvas transition-transform duration-300 ease-[cubic-bezier(.2,.7,.2,1)]",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          type="button"
          aria-label="Fechar navegação"
          onClick={() => setMobileNavOpen(false)}
          className="absolute top-3.5 right-3 z-10 grid size-7 place-items-center rounded-[7px] bg-canvas text-ink-2 hover:bg-white/[0.06]"
        >
          <X className="size-4" />
        </button>
        <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
      </aside>
    </div>
  );
}

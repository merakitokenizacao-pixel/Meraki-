"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PROJECT_PARTS, activeProject, projectHref, type ProjectPart } from "@/components/shell/nav";
import { cn } from "@/lib/utils";

/** Abas das partes do projeto — são links: cada parte tem a própria URL. */
export function PartTabs({ slug, counts }: { slug: string; counts: Record<ProjectPart, number | null> }) {
  const atual = activeProject(usePathname())?.part ?? "sistemas";
  return (
    <nav aria-label="Partes do projeto" className="inline-flex items-center gap-0.5 rounded-[7px] border border-line bg-sunken p-[3px]">
      {PROJECT_PARTS.map((pt) => {
        const active = pt.key === atual;
        const Icon = pt.icon;
        const n = counts[pt.key];
        return (
          <Link
            key={pt.key}
            href={projectHref(slug, pt.key)}
            aria-current={active ? "page" : undefined}
            title={pt.description}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-[4px] border px-3.5 text-[13px] font-medium transition-colors",
              active ? "border-line-2 bg-raised text-ink shadow-pill" : "border-transparent text-ink-3 hover:text-ink-2",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            {pt.label}
            {n !== null && n > 0 && <span className={cn("tnum", active ? "text-ink-3" : "text-ink-4")}>{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

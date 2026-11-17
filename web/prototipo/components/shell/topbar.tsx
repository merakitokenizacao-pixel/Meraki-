"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { Bell, ChevronDown, ChevronRight, Menu, Search, Sparkles } from "lucide-react";
import { Kbd } from "@/components/ui/misc";
import { MenuItem, MenuLabel, Popover } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { StatusDot } from "@/components/ui/status";
import { RESOURCES } from "@/lib/data/infra";
import { RANGE_KEYS, RANGES } from "@/lib/time";
import { cn } from "@/lib/utils";
import { crumbsFor } from "./nav";
import { useShell, type Env } from "./provider";

const ENV_OPTIONS: { value: Env; label: string; count: number }[] = [
  { value: "prod", label: "Produção", count: RESOURCES.filter((r) => r.env === "prod").length },
  { value: "staging", label: "Staging", count: RESOURCES.filter((r) => r.env === "staging").length },
  { value: "all", label: "Todos os ambientes", count: RESOURCES.length },
];

const RANGE_SHORT: Record<string, string> = { "1h": "1 h", "24h": "24 h", "7d": "7 d", "30d": "30 d" };

function Crumbs({ pathname }: { pathname: string }) {
  const crumbs = pathname ? crumbsFor(pathname) : [];
  return (
    <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
      {crumbs.map((c, i) => (
        // No celular ficam só os dois últimos níveis — o resto cabe na navegação.
        <li key={i} className={cn("min-w-0 items-center gap-1.5", i < crumbs.length - 2 ? "hidden sm:flex" : "flex")}>
          {i > 0 && <ChevronRight className={cn("size-3.5 shrink-0 text-ink-4", i === crumbs.length - 2 && "hidden sm:block")} />}
          {c.href ? (
            <Link href={c.href} className="truncate text-ink-3 transition-colors hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span className={cn("truncate", i === crumbs.length - 1 ? "font-medium text-ink" : "text-ink-3")}>{c.label}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function CrumbsWithPath() {
  return <Crumbs pathname={usePathname()} />;
}

const NOTIFICATIONS = [
  { id: "n1", title: "INC-2481 atribuído a Marina Costa", detail: "SEV-1 · Saturação de conexões no Postgres do Atlas", at: "1 h", status: "crit" as const },
  { id: "n2", title: "Aurora abaixo da meta há 3 dias", detail: "Precisão 81,8% · meta 90%", at: "2 h", status: "serious" as const },
  { id: "n3", title: "Relatório semanal de agentes pronto", detail: "12 agentes · 251 mil conversas avaliadas", at: "5 h", status: "ok" as const },
];

function Notifications() {
  const [unread, setUnread] = useState(NOTIFICATIONS.length);
  return (
    <Popover
      align="end"
      width={340}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Notificações"
          className={cn(
            "relative grid size-8 place-items-center rounded-[8px] text-ink-2 transition-colors hover:bg-raised hover:text-ink",
            open && "bg-raised text-ink",
          )}
        >
          <Bell className="size-4" strokeWidth={1.75} />
          {unread > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-crit ring-2 ring-canvas" />}
        </button>
      )}
    >
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1.5">
        <span className="text-[13px] font-medium text-ink">Notificações</span>
        <button type="button" onClick={() => setUnread(0)} className="text-[12px] text-ink-3 hover:text-ink">
          Marcar como lidas
        </button>
      </div>
      <ul className="pb-1">
        {NOTIFICATIONS.map((n, i) => (
          <li key={n.id} className="flex gap-2.5 rounded-[7px] px-2.5 py-2 hover:bg-muted">
            <StatusDot status={n.status} className="mt-1.5" />
            <div className="min-w-0 flex-1">
              <div className={cn("text-[13px] leading-snug", i < unread ? "font-medium text-ink" : "text-ink-2")}>{n.title}</div>
              <div className="mt-0.5 truncate text-[12px] text-ink-3">{n.detail}</div>
            </div>
            <span className="shrink-0 text-[11.5px] text-ink-3">{n.at}</span>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

export function Topbar() {
  const { range, setRange, env, setEnv, setPaletteOpen, openCopilot, setMobileNavOpen } = useShell();
  const envLabel = ENV_OPTIONS.find((e) => e.value === env)!;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4 sm:px-6">
      <button
        type="button"
        aria-label="Abrir navegação"
        onClick={() => setMobileNavOpen(true)}
        className="-ml-1 grid size-8 place-items-center rounded-[8px] text-ink-2 hover:bg-raised lg:hidden"
      >
        <Menu className="size-[18px]" />
      </button>

      <div className="min-w-0 flex-1">
        <Suspense fallback={<Crumbs pathname="" />}>
          <CrumbsWithPath />
        </Suspense>
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="hidden h-8 w-[240px] items-center gap-2 rounded-[8px] border border-line bg-surface pr-1.5 pl-2.5 text-left text-[13px] text-ink-3 transition-colors hover:border-line-2 xl:flex"
      >
        <Search className="size-4" strokeWidth={1.75} />
        <span className="flex-1 truncate">Buscar ou perguntar…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <button
        type="button"
        aria-label="Buscar"
        onClick={() => setPaletteOpen(true)}
        className="grid size-8 place-items-center rounded-[8px] text-ink-2 hover:bg-raised xl:hidden"
      >
        <Search className="size-4" strokeWidth={1.75} />
      </button>

      <Popover
        align="end"
        width={236}
        trigger={({ toggle, open }) => (
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "hidden h-8 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:border-line-2 sm:inline-flex",
              open && "border-line-2",
            )}
          >
            <span className={cn("size-[7px] rounded-full", env === "staging" ? "bg-ink-3" : "bg-ok")} />
            {envLabel.label}
            <ChevronDown className="size-3.5 text-ink-3" />
          </button>
        )}
      >
        {({ close }) => (
          <>
            <MenuLabel>Ambiente</MenuLabel>
            {ENV_OPTIONS.map((o) => (
              <MenuItem
                key={o.value}
                selected={env === o.value}
                hint={`${o.count} recursos`}
                onClick={() => {
                  setEnv(o.value);
                  close();
                }}
              >
                {o.label}
              </MenuItem>
            ))}
          </>
        )}
      </Popover>

      <div className="hidden md:block" title={RANGES[range].label}>
        <Segmented size="sm" ariaLabel="Janela de tempo" value={range} onChange={setRange} options={RANGE_KEYS.map((k) => ({ value: k, label: RANGE_SHORT[k] }))} />
      </div>

      <Notifications />

      <button
        type="button"
        onClick={() => openCopilot()}
        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line-2 bg-raised px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-muted sm:pr-3"
      >
        <Sparkles className="size-3.5 text-accent-ink" />
        <span className="hidden sm:inline">Copilot</span>
      </button>
    </header>
  );
}

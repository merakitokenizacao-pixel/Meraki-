"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, CornerDownLeft, Search, Siren, Sparkles } from "lucide-react";
import { Kbd } from "@/components/ui/misc";
import { ResourceIcon } from "@/components/ui/resource-icon";
import { SevBadge, StatusDot } from "@/components/ui/status";
import { AGENTS } from "@/lib/data/agents";
import { INCIDENTS } from "@/lib/data/incidents";
import { RESOURCES, TYPE_META } from "@/lib/data/infra";
import { PROJECTS } from "@/lib/data/projects";
import { cn, normalize } from "@/lib/utils";
import { ALL_NAV } from "./nav";
import { useShell } from "./provider";

type Item = {
  id: string;
  group: string;
  label: string;
  sub?: string;
  keywords: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  run: () => void;
};

const SUGGESTED_QUESTIONS = ["Por que a precisão do Aurora caiu?", "O que está saturando o Postgres do Atlas?", "Resumo da operação para o standup"];

function IconBox({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-[7px] border [&_svg]:size-[15px]",
        accent ? "border-accent/30 bg-accent-soft text-accent-ink" : "border-line-2 bg-muted text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, openCopilot } = useShell();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const all = useMemo<Item[]>(() => {
    const go = (href: string) => {
      setPaletteOpen(false);
      router.push(href);
    };
    const nav: Item[] = ALL_NAV.map((n) => {
      const Icon = n.icon;
      return {
        id: `nav:${n.href}`,
        group: "Navegação",
        label: n.label,
        sub: n.description,
        keywords: `${n.label} ${n.description}`,
        icon: (
          <IconBox>
            <Icon />
          </IconBox>
        ),
        run: () => go(n.href),
      };
    });
    const projects: Item[] = PROJECTS.map((p) => ({
      id: `proj:${p.id}`,
      group: "Projetos",
      label: p.name,
      sub: `${p.area} · ${p.description}`,
      keywords: `${p.name} ${p.area} projeto`,
      icon: (
        <IconBox>
          <span className="size-2.5 rounded-full" style={{ background: p.color }} />
        </IconBox>
      ),
      right: <span className="text-[12px] text-ink-3 tnum">Saúde {p.health}</span>,
      run: () => go(`/projetos/${p.id}`),
    }));
    const agents: Item[] = AGENTS.map((a) => ({
      id: `agent:${a.id}`,
      group: "Agentes de IA",
      label: a.name,
      sub: `${a.role} · ${a.model}`,
      keywords: `${a.name} ${a.role} ${a.model} ${a.project} agente`,
      icon: (
        <IconBox>
          <Bot />
        </IconBox>
      ),
      right: <StatusDot status={a.status} />,
      run: () => go(`/agentes/${a.id}`),
    }));
    const resources: Item[] = RESOURCES.map((r) => ({
      id: `res:${r.id}`,
      group: "Recursos",
      label: r.id,
      sub: `${TYPE_META[r.type].label} · ${r.label}`,
      keywords: `${r.id} ${r.label} ${TYPE_META[r.type].label} ${r.project}`,
      icon: (
        <IconBox>
          <ResourceIcon type={r.type} />
        </IconBox>
      ),
      right: <StatusDot status={r.status} />,
      run: () => go(`/infraestrutura?recurso=${r.id}`),
    }));
    const incidents: Item[] = INCIDENTS.map((i) => ({
      id: `inc:${i.id}`,
      group: "Incidentes",
      label: `${i.id} · ${i.title}`,
      sub: i.summary,
      keywords: `${i.id} ${i.title} incidente`,
      icon: (
        <IconBox>
          <Siren />
        </IconBox>
      ),
      right: <SevBadge sev={i.sev} />,
      run: () => go(`/incidentes?id=${i.id}`),
    }));
    return [...nav, ...agents, ...resources, ...incidents, ...projects];
  }, [router, setPaletteOpen]);

  const items = useMemo<Item[]>(() => {
    const query = normalize(q.trim());
    if (!query) {
      const ask: Item[] = SUGGESTED_QUESTIONS.map((text, i) => ({
        id: `ask:${i}`,
        group: "Perguntar ao Copilot",
        label: text,
        keywords: text,
        icon: (
          <IconBox accent>
            <Sparkles />
          </IconBox>
        ),
        run: () => openCopilot(text),
      }));
      const hot = ["inc:INC-2481", "agent:aurora", "res:atlas-pg-primary"]
        .map((id) => all.find((x) => x.id === id)!)
        .map((x) => ({ ...x, group: "Precisa de atenção" }));
      return [...hot, ...ask, ...all.filter((x) => x.group === "Navegação")];
    }
    const terms = query.split(/\s+/);
    const matched = all.filter((x) => {
      const hay = normalize(x.keywords);
      return terms.every((t) => hay.includes(t));
    });
    const byGroup = new Map<string, Item[]>();
    for (const m of matched) {
      const list = byGroup.get(m.group) ?? [];
      if (list.length < 5) list.push(m);
      byGroup.set(m.group, list);
    }
    const askItem: Item = {
      id: "ask:free",
      group: "Perguntar ao Copilot",
      label: `“${q.trim()}”`,
      sub: "Resposta com métricas, causa provável e próximos passos",
      keywords: q,
      icon: (
        <IconBox accent>
          <Sparkles />
        </IconBox>
      ),
      right: <span className="text-[12px] text-ink-3">Perguntar</span>,
      run: () => openCopilot(q.trim()),
    };
    return [...Array.from(byGroup.values()).flat(), askItem];
  }, [q, all, openCopilot]);

  // Reinicia a busca a cada abertura (padrão “ajustar estado quando a prop muda”).
  const [wasOpen, setWasOpen] = useState(paletteOpen);
  if (wasOpen !== paletteOpen) {
    setWasOpen(paletteOpen);
    if (paletteOpen) {
      setQ("");
      setActive(0);
    }
  }

  useEffect(() => {
    if (!paletteOpen) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [paletteOpen]);

  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === "Escape") {
      setPaletteOpen(false);
    }
  };

  return (
    <div className={cn("fixed inset-0 z-[60]", !paletteOpen && "pointer-events-none")} aria-hidden={!paletteOpen} inert={!paletteOpen}>
      <div
        onClick={() => setPaletteOpen(false)}
        className={cn("absolute inset-0 bg-black/60 transition-opacity duration-200", paletteOpen ? "opacity-100" : "opacity-0")}
      />
      <div
        role="dialog"
        aria-label="Busca e comandos"
        className={cn(
          "absolute top-[12vh] left-1/2 w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[14px] border border-line-2 bg-raised shadow-pop transition-[opacity,transform] duration-200 ease-[cubic-bezier(.2,.7,.2,1)]",
          paletteOpen ? "translate-y-0 scale-100 opacity-100" : "-translate-y-2 scale-[0.985] opacity-0",
        )}
      >
        <div className="flex items-center gap-3 border-b border-line-2 px-4">
          <Search className="size-[18px] shrink-0 text-ink-3" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Busque recursos, agentes, incidentes… ou pergunte"
            className="h-[52px] flex-1 bg-transparent text-[15px] text-ink outline-none"
            aria-label="Buscar"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-[min(440px,60vh)] overflow-y-auto p-2 scrollbar-thin">
          {items.map((it, i) => (
            <div key={it.id}>
              {(i === 0 || items[i - 1].group !== it.group) && (
                <div className={cn("px-2.5 pb-1.5 text-[11.5px] font-medium text-ink-3", i === 0 ? "pt-1.5" : "pt-3")}>{it.group}</div>
              )}
              <button
                type="button"
                data-index={i}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => it.run()}
                className={cn("flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left transition-colors", active === i && "bg-muted")}
              >
                {it.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-ink">{it.label}</span>
                  {it.sub && <span className="block truncate text-[12px] text-ink-3">{it.sub}</span>}
                </span>
                {it.right}
                <span className={cn("text-ink-3 transition-opacity", active === i ? "opacity-100" : "opacity-0")}>
                  {it.group === "Perguntar ao Copilot" ? <CornerDownLeft className="size-3.5" /> : <ArrowRight className="size-3.5" />}
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-line-2 px-4 py-2.5 text-[11.5px] text-ink-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navegar
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↵</Kbd> abrir
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-accent-ink" /> O Copilot entende perguntas em português
          </span>
        </div>
      </div>
    </div>
  );
}

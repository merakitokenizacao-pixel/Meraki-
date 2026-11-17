"use client";

import { useRouter } from "next/navigation";
import { Suspense, use, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, FileCheck, Layers, Search } from "lucide-react";
import { Kbd } from "@/components/ui/misc";
import { StatusDot } from "@/components/ui/status";
import { type DadosShell, SEV, corProjeto } from "@/lib/plataforma/modelo";
import { cn, normalize } from "@/lib/utils";
import { ALL_PROJECTS_HREF, PRIMARY_NAV, PROJECT_PARTS, agenteHref, projectHref } from "./nav";
import { useShell } from "./provider";

type Item = {
  id: string;
  group: string;
  label: string;
  sub?: string;
  keywords: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  href: string;
};

function IconBox({ children }: { children: React.ReactNode }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-[7px] border border-line-2 bg-muted text-ink-2 [&_svg]:size-[15px]">{children}</span>;
}

function staticItems(): Item[] {
  return [
    ...PRIMARY_NAV.map((n) => {
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
        href: n.href,
      };
    }),
    {
      id: "nav:projetos",
      group: "Navegação",
      label: "Todos os projetos",
      sub: "Saúde, cobertura do contrato e fontes de cada projeto",
      keywords: "todos os projetos lista",
      icon: (
        <IconBox>
          <Layers />
        </IconBox>
      ),
      href: ALL_PROJECTS_HREF,
    },
  ];
}

function dataItems(d: DadosShell): Item[] {
  const parts = d.projetos.flatMap((p) =>
    PROJECT_PARTS.map((pt) => {
      const Icon = pt.icon;
      return {
        id: `proj:${p.slug}:${pt.key}`,
        group: "Projetos",
        label: `${p.nome} · ${pt.label}`,
        sub: pt.description,
        keywords: `${p.nome} ${p.slug} ${pt.label} projeto`,
        icon: (
          <IconBox>
            <Icon />
          </IconBox>
        ),
        right: <span className="size-2 rounded-full" style={{ background: corProjeto(p.cor) }} />,
        href: projectHref(p.slug, pt.key),
      };
    }),
  );
  const propostas = d.propostas.map((p) => ({
    id: `prop:${p.id}`,
    group: "Aguardando decisão",
    label: p.justificativa,
    sub: `${p.projeto.nome} · proposta ${p.origem === "agente" ? "de agente" : "sua"}`,
    keywords: `${p.justificativa} ${p.projeto.nome} proposta contrato`,
    icon: (
      <IconBox>
        <FileCheck />
      </IconBox>
    ),
    href: projectHref(p.projeto.slug, "contrato"),
  }));
  const nomes = new Map(d.projetos.map((p) => [p.slug, p]));
  const agentes = d.agentes.map((a) => {
    const p = nomes.get(a.slug);
    return {
      id: `agente:${a.slug}:${a.id}`,
      group: "Agentes de IA",
      label: a.nome,
      sub: `${p?.nome ?? a.slug} · estrutura, casos, rodadas e produção`,
      keywords: `${a.nome} ${a.id} ${p?.nome ?? ""} agente ia`,
      icon: (
        <IconBox>
          <Bot />
        </IconBox>
      ),
      right: p ? <span className="size-2 rounded-full" style={{ background: corProjeto(p.cor) }} /> : undefined,
      href: agenteHref(a.slug, a.id),
    };
  });
  const achados = d.novos.map((a) => ({
    id: `ach:${a.id}`,
    group: "Achados novos",
    label: a.titulo,
    sub: `${a.projeto.nome} · ${a.regra} · ${SEV[a.severidade].label}`,
    keywords: `${a.titulo} ${a.regra} ${a.projeto.nome} achado`,
    icon: (
      <IconBox>
        <StatusDot status={SEV[a.severidade].status} />
      </IconBox>
    ),
    href: `/achados?achado=${a.id}`,
  }));
  return [...propostas, ...achados, ...parts, ...agentes];
}

function Results({ q, dados, onGo }: { q: string; dados: Promise<DadosShell> | null; onGo: (href: string) => void }) {
  const d = dados ? use(dados) : null;
  const all = useMemo(() => [...staticItems(), ...(d ? dataItems(d) : [])], [d]);
  const items = useMemo(() => {
    const query = normalize(q.trim());
    if (!query) return all.filter((x) => x.group !== "Projetos" || x.id.endsWith(":sistemas"));
    const terms = query.split(/\s+/);
    const byGroup = new Map<string, Item[]>();
    for (const x of all) {
      const hay = normalize(x.keywords);
      if (!terms.every((t) => hay.includes(t))) continue;
      const list = byGroup.get(x.group) ?? [];
      if (list.length < 6) list.push(x);
      byGroup.set(x.group, list);
    }
    return [...byGroup.values()].flat();
  }, [q, all]);

  const [active, setActive] = useState(0);
  const [lastQ, setLastQ] = useState(q);
  if (lastQ !== q) {
    setLastQ(q);
    setActive(0);
  }
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Teclado: o campo de busca dispara o evento; a lista responde.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(items.length - 1, a + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "Enter" && items[active]) {
        e.preventDefault();
        onGo(items[active].href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, active, onGo]);

  if (!items.length) return <div className="px-3 py-8 text-center text-[13px] text-ink-3">Nada encontrado para “{q.trim()}”.</div>;

  return (
    <div ref={listRef}>
      {items.map((it, i) => (
        <div key={it.id}>
          {(i === 0 || items[i - 1].group !== it.group) && (
            <div className={cn("px-2.5 pb-1.5 text-[11.5px] font-medium text-ink-3", i === 0 ? "pt-1.5" : "pt-3")}>{it.group}</div>
          )}
          <button
            type="button"
            data-index={i}
            onMouseMove={() => active !== i && setActive(i)}
            onClick={() => onGo(it.href)}
            className={cn("flex w-full items-center gap-3 rounded-[7px] px-2.5 py-2 text-left transition-colors", active === i && "bg-muted")}
          >
            {it.icon}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-ink">{it.label}</span>
              {it.sub && <span className="block truncate text-[12px] text-ink-3">{it.sub}</span>}
            </span>
            {it.right}
            <span className={cn("text-ink-3 transition-opacity", active === i ? "opacity-100" : "opacity-0")}>
              <ArrowRight className="size-3.5" />
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

export function CommandPalette({ dados }: { dados: Promise<DadosShell> }) {
  const { paletteOpen, setPaletteOpen } = useShell();
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reinicia a busca a cada abertura (padrão “ajustar estado quando a prop muda”).
  const [wasOpen, setWasOpen] = useState(paletteOpen);
  if (wasOpen !== paletteOpen) {
    setWasOpen(paletteOpen);
    if (paletteOpen) setQ("");
  }

  useEffect(() => {
    if (!paletteOpen) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [paletteOpen]);

  const go = (href: string) => {
    setPaletteOpen(false);
    router.push(href);
  };

  return (
    <div className={cn("fixed inset-0 z-[60]", !paletteOpen && "pointer-events-none")} aria-hidden={!paletteOpen} inert={!paletteOpen}>
      <div
        onClick={() => setPaletteOpen(false)}
        className={cn("absolute inset-0 bg-black/60 transition-opacity duration-200", paletteOpen ? "opacity-100" : "opacity-0")}
      />
      <div
        role="dialog"
        aria-label="Ir para"
        className={cn(
          "absolute top-[12vh] left-1/2 w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[10px] border border-line-2 bg-raised shadow-pop transition-[opacity,transform] duration-200 ease-[cubic-bezier(.2,.7,.2,1)]",
          paletteOpen ? "translate-y-0 scale-100 opacity-100" : "-translate-y-2 scale-[0.985] opacity-0",
        )}
      >
        <div className="flex items-center gap-3 border-b border-line-2 px-4">
          <Search className="size-[18px] shrink-0 text-ink-3" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setPaletteOpen(false)}
            placeholder="Busque projetos, partes, propostas e achados novos"
            className="h-[52px] flex-1 bg-transparent text-[15px] text-ink outline-none"
            aria-label="Buscar"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-[min(440px,60vh)] overflow-y-auto p-2 scrollbar-thin">
          {paletteOpen && (
            <Suspense fallback={<Results q={q} dados={null} onGo={go} />}>
              <Results q={q} dados={dados} onGo={go} />
            </Suspense>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line-2 px-4 py-2.5 text-[11.5px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navegar
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↵</Kbd> abrir
          </span>
        </div>
      </div>
    </div>
  );
}

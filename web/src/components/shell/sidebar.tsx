"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, createContext, use, useContext } from "react";
import { ChevronRight, ChevronsLeft, Layers, Menu, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/misc";
import { type DadosShell, type ProjetoNav, corProjeto } from "@/lib/plataforma/modelo";
import { relativo } from "@/lib/tempo";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { ALL_PROJECTS_HREF, PRIMARY_NAV, PROJECT_PARTS, activeProject, isActive, projectHref, type ProjectPart } from "./nav";
import { useShell } from "./provider";
import { setSidebarRecolhida, useSidebarAtributo, useSidebarRecolhida } from "./sidebar-estado";
import { SIDEBAR_SOME } from "./sidebar-recolhida";

/**
 * Verdadeiro no menu do desktop recolhido: sem o nome à vista, cada link leva o nome como dica (title).
 * Os pontos dos projetos, sozinhos, não dizem qual é qual.
 */
const Dica = createContext(false);

const itemClass = (active: boolean) =>
  cn(
    "group flex h-8 items-center gap-2.5 overflow-hidden rounded-[7px] px-2.5 text-[13.5px] transition-colors duration-150",
    active ? "bg-white/[0.07] text-ink" : "text-ink-2 hover:bg-white/[0.035] hover:text-ink",
  );

/** Nome do item: some no menu recolhido, mas continua no link para leitores de tela. */
function Rotulo({ children }: { children: React.ReactNode }) {
  return <span className={cn("flex-1 truncate", SIDEBAR_SOME)}>{children}</span>;
}

function Count({ n, title }: { n: number; title: string }) {
  if (!n) return null;
  return (
    <span className={cn("text-[12px] text-ink-3 tnum", SIDEBAR_SOME)} title={title}>
      {n}
    </span>
  );
}

/** Contagem de cada parte do projeto: achados abertos em Sistemas e nos agentes de IA, propostas aguardando em Contrato. */
function partCount(p: ProjetoNav, part: ProjectPart) {
  if (part === "sistemas") return { n: p.abertos, title: `${p.abertos} achados abertos` };
  if (part === "agentes") return { n: p.agentesAbertos, title: `${p.agentesAbertos} achados abertos nos agentes de IA` };
  if (part === "contrato") return { n: p.propostas, title: `${p.propostas} propostas aguardando decisão` };
  return { n: 0, title: "" };
}

/**
 * Linha de projeto: ao clicar, abre o projeto e revela as partes. Só o projeto ativo fica expandido.
 * Recolhido, as partes saem do menu (a tela do projeto tem as abas delas) e o ponto do projeto ativo ganha o destaque.
 */
function ProjectRow({ p, open, activePart, onNavigate }: { p: ProjetoNav; open: boolean; activePart: ProjectPart | null; onNavigate?: () => void }) {
  const dica = useContext(Dica);
  const pending = p.propostas + p.novos;
  return (
    <li>
      <Link
        href={projectHref(p.slug)}
        onClick={onNavigate}
        aria-expanded={open && !dica}
        title={dica ? p.nome : undefined}
        className={cn(
          "group flex h-8 items-center gap-2.5 overflow-hidden rounded-[7px] px-2.5 text-[13.5px] transition-colors duration-150",
          open ? "text-ink recolhida:bg-white/[0.07]" : "text-ink-2 hover:bg-white/[0.035] hover:text-ink",
        )}
      >
        <span className="grid size-4 shrink-0 place-items-center">
          <span className="size-2 rounded-full" style={{ background: corProjeto(p.cor) }} />
        </span>
        <Rotulo>{p.nome}</Rotulo>
        {!open && <Count n={pending} title={`${p.propostas} propostas aguardando · ${p.novos} achados novos graves`} />}
        <span className={cn("grid shrink-0 place-items-center", SIDEBAR_SOME)}>
          <ChevronRight className={cn("size-3.5 text-ink-4 transition-transform duration-200", open && "rotate-90 text-ink-3")} strokeWidth={2} />
        </span>
      </Link>
      {open && (
        <ul className="mt-0.5 mb-1.5 ml-[17px] space-y-0.5 border-l border-line pl-2 animate-fade recolhida:hidden">
          {PROJECT_PARTS.map((part) => {
            const active = activePart === part.key;
            const Icon = part.icon;
            const c = partCount(p, part.key);
            return (
              <li key={part.key}>
                <Link
                  href={projectHref(p.slug, part.key)}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex h-7 items-center gap-2 rounded-[6px] px-2 text-[13px] transition-colors duration-150",
                    active ? "bg-white/[0.07] text-ink" : "text-ink-3 hover:bg-white/[0.035] hover:text-ink",
                  )}
                >
                  <Icon className={cn("size-3.5 shrink-0", active ? "text-ink-2" : "text-ink-4 group-hover:text-ink-3")} strokeWidth={1.75} />
                  <span className="flex-1 truncate">{part.label}</span>
                  <Count n={c.n} title={c.title} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function PrimaryLinks({ pathname, novos, onNavigate }: { pathname: string; novos?: number; onNavigate?: () => void }) {
  const dica = useContext(Dica);
  return (
    <ul className="space-y-0.5">
      {PRIMARY_NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        const badge = item.href === "/achados" ? novos : undefined;
        const titulo = badge ? `${badge} achados novos de severidade crítica ou alta` : undefined;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={dica ? [item.label, titulo].filter(Boolean).join(" · ") : undefined}
              className={itemClass(active)}
            >
              <span className="relative shrink-0">
                <Icon className={cn("size-4", active ? "text-ink" : "text-ink-3 group-hover:text-ink-2")} strokeWidth={1.75} />
                {/* Recolhido, o número não cabe: fica um ponto sobre o ícone */}
                {badge ? <span aria-hidden className="absolute -top-0.5 -right-0.5 hidden size-[7px] rounded-full bg-crit ring-2 ring-canvas recolhida:block" /> : null}
              </span>
              <Rotulo>{item.label}</Rotulo>
              {badge ? (
                <span
                  title={titulo}
                  className={cn(
                    "grid h-[18px] min-w-[20px] place-items-center rounded-full bg-crit-soft px-1.5 text-[11px] font-medium text-crit-ink tnum",
                    SIDEBAR_SOME,
                  )}
                >
                  {badge}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ProjectsHeading() {
  return <div className={cn("mb-1.5 overflow-hidden px-2.5 text-[11.5px] font-medium whitespace-nowrap text-ink-3", SIDEBAR_SOME)}>Projetos</div>;
}

function AllProjectsRow({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const dica = useContext(Dica);
  const active = pathname === ALL_PROJECTS_HREF;
  return (
    <li>
      <Link
        href={ALL_PROJECTS_HREF}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={dica ? "Todos os projetos" : undefined}
        className={itemClass(active)}
      >
        <span className="grid size-4 shrink-0 place-items-center">
          <Layers className="size-3.5 text-ink-3" strokeWidth={1.75} />
        </span>
        <Rotulo>Todos os projetos</Rotulo>
      </Link>
    </li>
  );
}

function NavLinks({ pathname, dados, onNavigate }: { pathname: string; dados: DadosShell; onNavigate?: () => void }) {
  const current = activeProject(pathname);
  const novos = dados.projetos.reduce((s, p) => s + p.novos, 0);
  return (
    <nav className="space-y-6">
      <PrimaryLinks pathname={pathname} novos={novos} onNavigate={onNavigate} />
      <div>
        <ProjectsHeading />
        <ul className="space-y-0.5">
          <AllProjectsRow pathname={pathname} onNavigate={onNavigate} />
          {dados.projetos.map((p) => (
            <ProjectRow
              key={p.id}
              p={p}
              open={current?.slug === p.slug}
              activePart={current?.slug === p.slug ? current.part : null}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
        {dados.erro && <p className="mt-3 px-2.5 text-[12px] leading-snug text-ink-3 recolhida:hidden">Sem conexão com a plataforma.</p>}
      </div>
    </nav>
  );
}

/** Enquanto o banco responde: o mesmo desenho, com os projetos em esqueleto. */
function NavFallback({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-6" aria-busy="true">
      <PrimaryLinks pathname={pathname} onNavigate={onNavigate} />
      <div>
        <ProjectsHeading />
        <ul className="space-y-0.5">
          <AllProjectsRow pathname={pathname} onNavigate={onNavigate} />
          {[0, 1].map((i) => (
            <li key={i} className="flex h-8 items-center gap-2.5 overflow-hidden px-2.5">
              <span className="grid size-4 shrink-0 place-items-center">
                <Skeleton className="size-2 rounded-full" />
              </span>
              <Skeleton className="h-3 w-28 shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function NavWithData({ dados, onNavigate }: { dados: Promise<DadosShell>; onNavigate?: () => void }) {
  const pathname = usePathname();
  const d = use(dados);
  return <NavLinks pathname={pathname} dados={d} onNavigate={onNavigate} />;
}

function NavPending({ onNavigate }: { onNavigate?: () => void }) {
  return <NavFallback pathname={usePathname()} onNavigate={onNavigate} />;
}

/** Status da coleta e quem está na sessão. Recolhido, ficam o ponto e o avatar, no eixo dos ícones. */
function Footer({ dados }: { dados: Promise<DadosShell> }) {
  const d = use(dados);
  const dica = useContext(Dica);
  const nome = d.usuario ?? "Sessão local";
  const status = d.erro ? "Plataforma indisponível" : `Última coleta ${relativo(d.ultimaColeta, d.agora)} · ${d.fontes} fontes`;
  return (
    <>
      <div className="mb-2 flex items-center gap-2.5 overflow-hidden px-2.5 text-[12px] text-ink-3" title={d.erro ?? (dica ? status : undefined)}>
        <span className="grid size-4 shrink-0 place-items-center">
          <span className={cn("size-1.5 rounded-full", d.erro ? "bg-crit" : "animate-breathe bg-ok")} />
        </span>
        <span className={cn("truncate", SIDEBAR_SOME)}>{status}</span>
      </div>
      <div className="flex items-center gap-2.5 overflow-hidden rounded-[8px] px-1 py-1">
        <Avatar name={nome} size={28} />
        <div className={cn("min-w-0 flex-1 leading-tight", SIDEBAR_SOME)}>
          <div className="truncate text-[13px] font-medium text-ink">{nome}</div>
          <div className="truncate text-[11.5px] text-ink-3">{d.conta ?? "—"}</div>
        </div>
      </div>
    </>
  );
}

function FooterFallback() {
  return (
    <>
      <div className="mb-2 flex h-[18px] items-center gap-2.5 overflow-hidden px-2.5">
        <span className="grid size-4 shrink-0 place-items-center">
          <Skeleton className="size-1.5 rounded-full" />
        </span>
        <Skeleton className="h-3 w-36 shrink-0" />
      </div>
      <div className="flex items-center gap-2.5 overflow-hidden px-1 py-1">
        <Skeleton className="size-7 shrink-0 rounded-full" />
        <div className="shrink-0 space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
    </>
  );
}

/**
 * Conteúdo do menu, igual no desktop e na gaveta do celular. Sem divisores (como na VoraX: espaço separa
 * região, linha só delimita objeto). `acao` fica à direita do nome: a seta de recolher ou o fechar da gaveta.
 */
export function SidebarContent({ dados, onNavigate, acao }: { dados: Promise<DadosShell>; onNavigate?: () => void; acao?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      {/* Nome e seta na linha do título das telas. O link encolhe até zero no menu recolhido e não empurra a seta. */}
      <div className="mx-3 mt-3 mb-5 flex h-8 shrink-0 items-center justify-between lg:mt-8">
        <Link
          href="/"
          onClick={onNavigate}
          aria-label="Meraki — visão geral"
          className={cn("min-w-0 overflow-hidden rounded-[6px]", SIDEBAR_SOME, "recolhida:invisible")}
        >
          <Logo className="block px-2.5 py-1" />
        </Link>
        {acao}
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-5 no-scrollbar">
        <Suspense fallback={<NavFallback pathname="" onNavigate={onNavigate} />}>
          <Suspense fallback={<NavPending onNavigate={onNavigate} />}>
            <NavWithData dados={dados} onNavigate={onNavigate} />
          </Suspense>
        </Suspense>
      </div>
      <div className="shrink-0 px-3 pt-2 pb-3">
        <Suspense fallback={<FooterFallback />}>
          <Footer dados={dados} />
        </Suspense>
      </div>
    </div>
  );
}

/** Seta do topo do menu: recolhe para só os ícones e abre de novo. A escolha fica salva neste navegador. */
function SidebarToggle({ recolhida }: { recolhida: boolean }) {
  const rotulo = recolhida ? "Expandir menu" : "Recolher menu";
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={() => setSidebarRecolhida(!recolhida)}
      className="grid h-8 w-9 shrink-0 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-white/[0.05] hover:text-ink"
    >
      <ChevronsLeft aria-hidden className="size-4 transition-transform duration-200 recolhida:rotate-180 motion-reduce:transition-none" strokeWidth={1.75} />
    </button>
  );
}

/**
 * Menu lateral do desktop. Sem fundo próprio: fica no chão da página, e só a hairline da direita o separa do campo.
 * Recolhido, tem 61px: 36 de ícone, 12 de cada lado e a hairline.
 */
export function Sidebar({ dados }: { dados: Promise<DadosShell> }) {
  const recolhida = useSidebarRecolhida();
  useSidebarAtributo();
  return (
    <aside
      data-sidebar-root
      aria-label="Navegação"
      className="hidden w-[240px] shrink-0 overflow-hidden border-r border-line transition-[width] duration-200 ease-out recolhida:w-[61px] motion-reduce:transition-none lg:block"
    >
      <Dica value={recolhida}>
        <SidebarContent dados={dados} acao={<SidebarToggle recolhida={recolhida} />} />
      </Dica>
    </aside>
  );
}

/** Barra do celular: abre a gaveta de navegação e mostra o nome. Sem divisor embaixo, como no desktop. */
export function MobileBar() {
  const { setMobileNavOpen } = useShell();
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-3 lg:hidden">
      <button
        type="button"
        aria-label="Abrir navegação"
        onClick={() => setMobileNavOpen(true)}
        className="grid size-8 place-items-center rounded-[7px] text-ink-2 transition-colors hover:bg-white/[0.06] hover:text-ink"
      >
        <Menu className="size-[18px]" strokeWidth={1.75} />
      </button>
      <Link href="/" aria-label="Meraki — visão geral" className="rounded-[6px] px-1.5 py-1">
        <Logo className="block" />
      </Link>
    </header>
  );
}

export function MobileNav({ dados }: { dados: Promise<DadosShell> }) {
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  const fechar = () => setMobileNavOpen(false);
  return (
    <div className="lg:hidden">
      <div
        aria-hidden
        onClick={fechar}
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
        <SidebarContent
          dados={dados}
          onNavigate={fechar}
          acao={
            <button
              type="button"
              aria-label="Fechar navegação"
              onClick={fechar}
              className="grid size-8 shrink-0 place-items-center rounded-[7px] text-ink-2 transition-colors hover:bg-white/[0.06] hover:text-ink"
            >
              <X className="size-4" />
            </button>
          }
        />
      </aside>
    </div>
  );
}

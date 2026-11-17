import { Bot, LayoutDashboard, Server, Siren, Telescope, type LucideIcon } from "lucide-react";
import { AGENTS, agentById } from "@/lib/data/agents";
import { ACTIVE_INCIDENTS } from "@/lib/data/incidents";
import { RESOURCES } from "@/lib/data/infra";
import { projectById } from "@/lib/data/projects";

export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: number; description: string };

/** Ferramentas globais — ficam acima da seção de projetos. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard, description: "Saúde geral, prioridades e atividade" },
  {
    href: "/incidentes",
    label: "Incidentes",
    icon: Siren,
    badge: ACTIVE_INCIDENTS.length,
    description: "Incidentes ativos, linha do tempo e hipóteses",
  },
  { href: "/explorar", label: "Explorar", icon: Telescope, description: "Consultas em linguagem natural e filtros avançados" },
];

/** Cada projeto se divide em duas partes — a mesma divisão vale para “Todos os projetos”. */
export type ProjectPart = "sistemas" | "agentes";

export const PROJECT_PARTS: { key: ProjectPart; label: string; icon: LucideIcon }[] = [
  { key: "sistemas", label: "Sistemas", icon: Server },
  { key: "agentes", label: "Agentes", icon: Bot },
];

export const projectHref = (id: string, part: ProjectPart = "sistemas") => (part === "sistemas" ? `/projetos/${id}` : `/projetos/${id}/agentes`);

/** Visões de todos os projetos (rotas globais). */
export const ALL_PROJECTS_HREF: Record<ProjectPart, string> = { sistemas: "/infraestrutura", agentes: "/agentes" };

const resourceAlerts = (project?: string) =>
  RESOURCES.filter((r) => (!project || r.project === project) && r.status !== "ok" && r.status !== "maint").length;
const agentAlerts = (project?: string) => AGENTS.filter((a) => (!project || a.project === project) && a.status !== "ok").length;

/** Itens que precisam de atenção em cada parte — `undefined` = todos os projetos. */
export function attentionCount(project: string | undefined, part: ProjectPart) {
  return part === "sistemas" ? resourceAlerts(project) : agentAlerts(project);
}

/** Destinos da paleta de comandos. */
export const ALL_NAV: NavItem[] = [
  ...PRIMARY_NAV,
  { href: "/infraestrutura", label: "Sistemas", icon: Server, description: "Infraestrutura de todos os projetos — bancos, filas, serviços e clusters" },
  { href: "/agentes", label: "Agentes de IA", icon: Bot, description: "Precisão, resolução e conversas de todos os agentes" },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Projeto e parte ativos a partir do caminho. A página de um agente pertence
 * ao projeto dele, então a navegação continua aberta no lugar de onde se veio.
 */
export function activeProject(pathname: string): { id: string; part: ProjectPart } | null {
  const p = pathname.match(/^\/projetos\/([^/]+)(\/agentes)?\/?$/);
  if (p) return { id: p[1], part: p[2] ? "agentes" : "sistemas" };
  const a = pathname.match(/^\/agentes\/([^/]+)\/?$/);
  const agent = a ? agentById(a[1]) : undefined;
  return agent ? { id: agent.project, part: "agentes" } : null;
}

/** Parte ativa da visão de todos os projetos. */
export function allProjectsPart(pathname: string): ProjectPart | null {
  if (pathname === ALL_PROJECTS_HREF.sistemas) return "sistemas";
  if (pathname === ALL_PROJECTS_HREF.agentes) return "agentes";
  return null;
}

/** Migalhas de pão a partir do caminho atual. */
export function crumbsFor(pathname: string): { label: string; href?: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return [{ label: "Visão geral" }];

  const all = allProjectsPart(pathname);
  if (all) return [{ label: "Todos os projetos" }, { label: all === "sistemas" ? "Sistemas" : "Agentes" }];

  const current = activeProject(pathname);
  if (current) {
    const name = projectById(current.id)?.name ?? current.id;
    const trail = [{ label: "Projetos" }, { label: name, href: projectHref(current.id) }];
    if (parts[0] === "agentes") {
      return [...trail, { label: "Agentes", href: projectHref(current.id, "agentes") }, { label: agentById(parts[1])?.name ?? parts[1] }];
    }
    return [...trail, { label: current.part === "agentes" ? "Agentes" : "Sistemas" }];
  }

  const item = PRIMARY_NAV.find((n) => n.href === `/${parts[0]}`);
  return [{ label: item?.label ?? parts[0] }];
}

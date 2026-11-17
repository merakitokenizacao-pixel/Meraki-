import { Bot, FileCheck, LayoutDashboard, ScanSearch, Server, ShieldCheck, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; description: string };

/** Ferramentas globais — ficam acima da seção de projetos. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard, description: "Saúde da estrutura, decisões pendentes e atividade do gate" },
  { href: "/achados", label: "Achados", icon: ScanSearch, description: "Tudo o que o motor encontrou, com evidência e severidade" },
];

/** Cada projeto se divide em quatro partes, cada uma com a própria URL. */
export type ProjectPart = "sistemas" | "agentes" | "gate" | "contrato";

export const PROJECT_PARTS: { key: ProjectPart; label: string; icon: LucideIcon; description: string }[] = [
  { key: "sistemas", label: "Sistemas", icon: Server, description: "Fontes, fluxo de uso, achados e inventário" },
  { key: "agentes", label: "Agentes", icon: Bot, description: "Agentes de IA: estrutura, casos de referência, rodadas e produção" },
  { key: "gate", label: "Gate", icon: ShieldCheck, description: "O que os agentes de código e o n8n tentaram e o que o gate decidiu" },
  { key: "contrato", label: "Contrato", icon: FileCheck, description: "Intenção declarada, propostas e exceções" },
];

export const projectHref = (slug: string, part: ProjectPart = "sistemas") => (part === "sistemas" ? `/projetos/${slug}` : `/projetos/${slug}/${part}`);

/** Página de um agente de IA (o id é o nome no contrato ou workflow-node). */
export const agenteHref = (slug: string, id: string) => `/projetos/${slug}/agentes/${encodeURIComponent(id)}`;

export const ALL_PROJECTS_HREF = "/projetos";

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Projeto, parte e (na parte Agentes) o agente ativos a partir do caminho. */
export function activeProject(pathname: string): { slug: string; part: ProjectPart; agente?: string } | null {
  const m = pathname.match(/^\/projetos\/([^/]+)(?:\/(agentes|gate|contrato)(?:\/([^/]+))?)?\/?$/);
  if (!m) return null;
  const part = (m[2] as ProjectPart | undefined) ?? "sistemas";
  if (m[3] && part !== "agentes") return null;
  return { slug: decodeURIComponent(m[1]), part, ...(m[3] && { agente: decodeURIComponent(m[3]) }) };
}

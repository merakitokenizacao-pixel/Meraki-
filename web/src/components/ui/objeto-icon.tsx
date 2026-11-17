import {
  Archive,
  Bot,
  Braces,
  CircleDot,
  Columns3,
  Database,
  Eye,
  FileClock,
  FileCode,
  FolderGit2,
  KeyRound,
  Link2,
  ListOrdered,
  MessageSquareText,
  Puzzle,
  Route,
  ShieldCheck,
  Shapes,
  SquareFunction,
  Table2,
  UserCog,
  Variable,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

const OBJETO: Record<string, LucideIcon> = {
  tabela: Table2,
  visao: Eye,
  coluna: Columns3,
  funcao: SquareFunction,
  policy: ShieldCheck,
  gatilho: Zap,
  constraint: Link2,
  indice: ListOrdered,
  bucket: Archive,
  extensao: Puzzle,
  migracao: FileClock,
  papel: UserCog,
  workflow: Workflow,
  node: CircleDot,
  credencial: KeyRound,
  arquivo: FileCode,
  chamada: Braces,
  env: Variable,
  rota: Route,
  agente: Bot,
  prompt: MessageSquareText,
};

const FONTE: Record<string, LucideIcon> = { supabase: Database, postgres: Database, n8n: Workflow, repo: FolderGit2 };

export function ObjetoIcon({ tipo, className, strokeWidth = 1.75 }: { tipo: string; className?: string; strokeWidth?: number }) {
  const Icon = OBJETO[tipo] ?? Shapes;
  return <Icon className={className} strokeWidth={strokeWidth} />;
}

export function FonteIcon({ tipo, className, strokeWidth = 1.75 }: { tipo: string; className?: string; strokeWidth?: number }) {
  const Icon = FONTE[tipo] ?? Shapes;
  return <Icon className={className} strokeWidth={strokeWidth} />;
}

/** Ícone em caixa — mesma anatomia das linhas de lista e dos nós do fluxo. */
export function IconBox({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-[8px] border border-line bg-subtle text-ink-2 [&_svg]:size-4 ${className ?? ""}`}>
      {children}
    </span>
  );
}

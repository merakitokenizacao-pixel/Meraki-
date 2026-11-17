import { AppShell } from "@/components/shell/app-shell";
import { dadosDoShell } from "@/lib/plataforma/consultas";

/**
 * A moldura não espera o banco: a promessa segue para o cliente e cada pedaço (projetos, contadores,
 * avisos) aparece quando chega. dadosDoShell nunca rejeita — sem banco, a moldura mostra o aviso.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AppShell dados={dadosDoShell()}>{children}</AppShell>;
}

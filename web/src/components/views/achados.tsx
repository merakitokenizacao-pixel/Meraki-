import { PageHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat";
import { type Achado, SEV, piorSeveridade } from "@/lib/plataforma/modelo";
import { plural } from "@/lib/url";
import { ListaAchados } from "./lista-achados";

/** Indicadores do topo de qualquer lista de achados (global ou de um projeto). */
export function IndicadoresAchados({ achados }: { achados: Achado[] }) {
  const abertos = achados.filter((a) => a.status === "aberto");
  const novos = abertos.filter((a) => !a.herdado);
  const graves = (l: Achado[]) => l.filter((a) => a.severidade === "critico" || a.severidade === "alto").length;
  const pior = piorSeveridade(abertos.map((a) => a.severidade));
  const criticos = abertos.filter((a) => a.severidade === "critico").length;
  return (
    <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
      <StatCard
        label="Achados abertos"
        value={abertos.length}
        status={pior ? SEV[pior].status : "ok"}
        foot={abertos.length ? `${plural(criticos, "crítico", "críticos")} · ${plural(graves(abertos) - criticos, "alto", "altos")}` : "Nada aberto"}
      />
      <StatCard label="Novos desde a linha de base" value={novos.length} foot={`${graves(novos)} críticos ou altos · entram na saúde`} />
      <StatCard label="Dívida herdada" value={abertos.length - novos.length} foot="Encontrada na primeira coleta" />
      <StatCard label="Em exceção" value={achados.filter((a) => a.status === "excecao").length} foot="Com motivo, autor e validade" />
    </div>
  );
}

export function AchadosView({ achados, agora }: { achados: Achado[]; agora: number }) {
  const projetos = new Set(achados.map((a) => a.projeto.slug)).size;
  return (
    <div className="animate-enter">
      <PageHeader
        title="Achados"
        description={`O que o motor encontrou em ${plural(projetos, "projeto", "projetos")}, com a evidência de cada um · resolvidos dos últimos 90 dias`}
      />
      <IndicadoresAchados achados={achados} />
      <div className="mt-9">
        <ListaAchados achados={achados} agora={agora} mostrarProjeto />
      </div>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { TimeSeriesChart, type TSeries } from "@/components/charts/time-series";
import { type PontoDiario, type ProjetoRef, corProjeto } from "@/lib/plataforma/modelo";
import { diaCurto } from "@/lib/tempo";
import { fmtDec } from "@/lib/format";

/** Saúde diária por projeto: uma série por projeto, na cor fixa do projeto. Dia sem ponto repete o anterior. */
export function GraficoSaude({ serie, projetos }: { serie: PontoDiario[]; projetos: ProjetoRef[] }) {
  const { labels, series } = useMemo(() => {
    const dias = [...new Set(serie.map((s) => s.dia))].sort();
    const series: TSeries[] = projetos.map((p) => {
      const pontos = new Map(serie.filter((s) => s.slug === p.slug && s.saude !== null).map((s) => [s.dia, s.saude as number]));
      let ultimo = pontos.values().next().value ?? 0;
      return {
        key: p.slug,
        name: p.nome,
        color: corProjeto(p.cor),
        data: dias.map((d) => (ultimo = pontos.get(d) ?? ultimo)),
      };
    });
    return { labels: dias.map(diaCurto), series };
  }, [serie, projetos]);

  return (
    <TimeSeriesChart
      labels={labels}
      series={series}
      height={232}
      yDomain={[0, 100]}
      valueFormat={(v) => fmtDec(v, 1)}
      yWidth={36}
    />
  );
}

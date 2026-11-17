"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Mono, Pill, ProjectTag } from "@/components/ui/misc";
import { MultiSelectChip } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { SevChip, STATUS_META } from "@/components/ui/status";
import { type Achado, PACOTE, SEV, SEVERIDADES, type StatusAchado, corProjeto, nomeDaChave, refCurta } from "@/lib/plataforma/modelo";
import { relativo } from "@/lib/tempo";
import { setSearchParam } from "@/lib/url";
import { cn, normalize } from "@/lib/utils";
import { AchadoDrawer } from "./achado-drawer";

type Origem = "todos" | "novos" | "herdados";

const COLS = {
  projeto: "@4xl:grid-cols-[92px_minmax(0,1fr)_150px_96px_104px]",
  simples: "@4xl:grid-cols-[92px_minmax(0,1fr)_96px_104px]",
};

function Linha({ a, agora, mostrarProjeto }: { a: Achado; agora: number; mostrarProjeto: boolean }) {
  return (
    <button
      type="button"
      onClick={() => setSearchParam("achado", a.id)}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-subtle",
        mostrarProjeto ? COLS.projeto : COLS.simples,
      )}
    >
      <span className="col-span-2 @4xl:col-span-1">
        <SevChip sev={a.severidade} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-medium text-ink">{a.titulo}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
          <Mono className="shrink-0 text-[11.5px] text-ink-3">{a.regra}</Mono>
          <span className="shrink-0">·</span>
          <span className="truncate">{a.regraTitulo ?? "regra"}</span>
          <span className="shrink-0">·</span>
          <Mono className="truncate text-[11.5px] text-ink-3" title={a.objeto}>
            {nomeDaChave(refCurta(a.objeto))}
          </Mono>
        </span>
      </span>
      {mostrarProjeto && (
        <span className="hidden min-w-0 @4xl:block">
          <ProjectTag projeto={a.projeto} />
        </span>
      )}
      <span className="hidden @4xl:block">
        {a.herdado ? <span className="text-[12.5px] text-ink-3">Herdado</span> : <Pill className="text-ink">Novo</Pill>}
      </span>
      <span className="text-right text-[12px] text-ink-3 tnum">
        {a.status === "resolvido" && a.resolvidoEm ? `resolvido ${relativo(a.resolvidoEm, agora)}` : relativo(a.primeiroVisto, agora)}
      </span>
    </button>
  );
}

function ListaComFiltros({ achados, agora, mostrarProjeto }: { achados: Achado[]; agora: number; mostrarProjeto: boolean }) {
  const params = useSearchParams();
  const [status, setStatus] = useState<StatusAchado>("aberto");
  const [origem, setOrigem] = useState<Origem>(() => (params.get("origem") === "novos" ? "novos" : params.get("origem") === "herdados" ? "herdados" : "todos"));
  const [q, setQ] = useState("");
  const [sevs, setSevs] = useState<string[]>([]);
  const [projetos, setProjetos] = useState<string[]>([]);
  const [pacotes, setPacotes] = useState<string[]>([]);

  const porStatus = useMemo(() => achados.filter((a) => a.status === status), [achados, status]);
  const visiveis = useMemo(() => {
    const termo = normalize(q.trim());
    return porStatus.filter(
      (a) =>
        (origem === "todos" || (origem === "novos" ? !a.herdado : a.herdado)) &&
        (!sevs.length || sevs.includes(a.severidade)) &&
        (!projetos.length || projetos.includes(a.projeto.slug)) &&
        (!pacotes.length || (a.pacote && pacotes.includes(a.pacote))) &&
        (!termo || normalize(`${a.titulo} ${a.regra} ${a.regraTitulo ?? ""} ${a.objeto} ${a.par ?? ""} ${a.detalhe ?? ""}`).includes(termo)),
    );
  }, [porStatus, origem, sevs, projetos, pacotes, q]);

  const contar = (s: StatusAchado) => achados.filter((a) => a.status === s).length;
  const filtros = q || sevs.length || projetos.length || pacotes.length || origem !== "todos";
  const projetosAll = [...new Map(achados.map((a) => [a.projeto.slug, a.projeto])).values()];
  const pacotesAll = [...new Set(achados.map((a) => a.pacote).filter((p): p is string => Boolean(p)))].sort();

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Situação"
          value={status}
          onChange={setStatus}
          options={[
            { value: "aberto", label: "Abertos", count: contar("aberto") },
            { value: "excecao", label: "Em exceção", count: contar("excecao") },
            { value: "resolvido", label: "Resolvidos", count: contar("resolvido") },
          ]}
        />
        <Segmented
          ariaLabel="Origem"
          value={origem}
          onChange={setOrigem}
          options={[
            { value: "todos", label: "Todos" },
            { value: "novos", label: "Novos", count: porStatus.filter((a) => !a.herdado).length },
            { value: "herdados", label: "Herdados", count: porStatus.filter((a) => a.herdado).length },
          ]}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por título, regra ou objeto" className="w-full sm:w-[280px]" />
        <MultiSelectChip
          label="Severidade"
          value={sevs}
          onChange={setSevs}
          options={SEVERIDADES.map((s) => ({ value: s, label: SEV[s].label, marker: STATUS_META[SEV[s].status].hex, count: porStatus.filter((a) => a.severidade === s).length }))}
        />
        {mostrarProjeto && projetosAll.length > 1 && (
          <MultiSelectChip
            label="Projeto"
            value={projetos}
            onChange={setProjetos}
            options={projetosAll.map((p) => ({ value: p.slug, label: p.nome, marker: corProjeto(p.cor), count: porStatus.filter((a) => a.projeto.slug === p.slug).length }))}
          />
        )}
        <MultiSelectChip
          label="Pacote"
          value={pacotes}
          onChange={setPacotes}
          options={pacotesAll.map((p) => ({ value: p, label: PACOTE[p] ?? p, count: porStatus.filter((a) => a.pacote === p).length }))}
        />
        {filtros ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setSevs([]);
              setProjetos([]);
              setPacotes([]);
              setOrigem("todos");
            }}
          >
            Limpar filtros
          </Button>
        ) : null}
        <span className="ml-auto text-[12px] text-ink-3 tnum">
          {visiveis.length} de {porStatus.length}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className={cn("hidden gap-x-4 border-b border-line bg-sunken px-5 py-2 text-[11.5px] font-medium text-ink-3 @4xl:grid", mostrarProjeto ? COLS.projeto : COLS.simples)}>
          <span>Severidade</span>
          <span>Achado</span>
          {mostrarProjeto && <span>Projeto</span>}
          <span>Origem</span>
          <span className="text-right">{status === "resolvido" ? "Resolvido" : "Visto pela 1ª vez"}</span>
        </div>
        {visiveis.length ? (
          <div className="divide-y divide-line">
            {visiveis.map((a) => (
              <Linha key={a.id} a={a} agora={agora} mostrarProjeto={mostrarProjeto} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ScanSearch className="size-5" />}
            title={porStatus.length ? "Nenhum achado com esses filtros" : status === "aberto" ? "Nenhum achado aberto" : "Nada por aqui"}
            description={porStatus.length ? "Ajuste a busca ou limpe os filtros." : undefined}
          />
        )}
      </Card>
    </>
  );
}

/** Lista de achados com filtros e a gaveta de detalhe (`?achado=`). Usada na tela Achados e em cada projeto. */
export function ListaAchados({ achados, agora, mostrarProjeto = false }: { achados: Achado[]; agora: number; mostrarProjeto?: boolean }) {
  return (
    <>
      <Suspense fallback={null}>
        <ListaComFiltros achados={achados} agora={agora} mostrarProjeto={mostrarProjeto} />
      </Suspense>
      <Suspense fallback={null}>
        <AchadoDrawer achados={achados} agora={agora} />
      </Suspense>
    </>
  );
}

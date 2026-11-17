"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, FlaskConical } from "lucide-react";
import { Card, Section } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { EmptyState, Mono, Pill } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { StatusChip, StatusDot } from "@/components/ui/status";
import { type DetalheAgente, MOTIVO_RODADA, type ResultadoDoCaso, type Rodada, STATUS_RODADA, versaoCurta } from "@/lib/plataforma/modelo";
import { dataHora, relativo } from "@/lib/tempo";
import { fmtMs } from "@/lib/format";
import { plural } from "@/lib/url";
import { cn } from "@/lib/utils";
import { ResultadoRodada, pct } from "./agente-comum";

type Mudanca = "quebrou" | "consertou" | "falha" | "passa" | "novo" | "saiu";
const MUDANCA: Record<Mudanca, { label: string; ordem: number }> = {
  quebrou: { label: "quebrou", ordem: 0 },
  falha: { label: "falha nas duas", ordem: 1 },
  novo: { label: "só na candidata", ordem: 2 },
  consertou: { label: "consertou", ordem: 3 },
  saiu: { label: "só na base", ordem: 4 },
  passa: { label: "passa nas duas", ordem: 5 },
};

function mudancaDe(a: ResultadoDoCaso | undefined, b: ResultadoDoCaso | undefined): Mudanca {
  if (!a) return "novo";
  if (!b) return "saiu";
  if (a.passou && !b.passou) return "quebrou";
  if (!a.passou && b.passou) return "consertou";
  return a.passou ? "passa" : "falha";
}

/** Rótulo da versão da rodada frente ao agente: no ar, rascunho ou anterior. */
function rotuloDaVersao(d: DetalheAgente, hash: string) {
  if (hash === d.resumo.versao) return "no ar";
  if (hash === d.resumo.rascunho) return "rascunho";
  const pub = d.publicacoes.find((p) => p.hash === hash);
  return pub ? "publicada antes" : "versão de teste";
}

function opcaoDeRodada(d: DetalheAgente, r: Rodada) {
  return `v${versaoCurta(r.hash)} · ${rotuloDaVersao(d, r.hash)} · ${pct(r.aprovacao)} · ${dataHora(r.concluidaEm ?? r.criadoEm)}`;
}

/** Base = a última da versão no ar; candidata = a última do rascunho (ou a mais recente que não é a base). */
function escolhaPadrao(d: DetalheAgente, concluidas: Rodada[]) {
  const candidata =
    (d.resumo.divergente ? concluidas.find((r) => r.hash === d.resumo.rascunho) : undefined) ?? concluidas[0];
  const base = concluidas.find((r) => r.hash === d.resumo.versao && r.id !== candidata?.id) ?? concluidas.find((r) => r.id !== candidata?.id && r.hash !== candidata?.hash) ?? concluidas.find((r) => r.id !== candidata?.id);
  return { base: base?.id ?? "", candidata: candidata?.id ?? "" };
}

function Lado({ r, titulo }: { r: ResultadoDoCaso | undefined; titulo: string }) {
  if (!r) return <div className="rounded-[7px] border border-dashed border-line-2 px-4 py-3 text-[12.5px] text-ink-3">{titulo}: o caso não entrou nesta rodada.</div>;
  const juiz = r.juiz && typeof r.juiz === "object" && !Array.isArray(r.juiz) ? Object.entries(r.juiz as Record<string, unknown>) : [];
  return (
    <div className="min-w-0 space-y-3 rounded-[7px] border border-line bg-subtle px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-2">{titulo}</span>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
          <StatusDot status={r.passou ? "ok" : r.criticidade === "critico" ? "crit" : "serious"} className="size-1.5" />
          {r.passou ? "passou" : "falhou"}
          {r.duracaoMs !== null && <span className="text-ink-3"> · {fmtMs(r.duracaoMs)}</span>}
        </span>
      </div>
      <ul className="space-y-1.5">
        {r.checagens.map((c, i) => (
          <li key={`${c.nome}:${i}`} className="flex gap-2 text-[12px] leading-snug">
            <StatusDot status={c.passou ? "ok" : "crit"} className="mt-[5px] size-1.5" />
            <span className="min-w-0">
              <span className="text-ink">{c.nome}</span> <span className="text-ink-3">· {c.detalhe}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="text-[12px] text-ink-3">
        Tools chamadas:{" "}
        {r.tools.length ? (
          <Mono className="text-[11.5px]">{r.tools.map((t) => t.nome).join(" → ")}</Mono>
        ) : (
          "nenhuma"
        )}
        {r.repasse !== null && ` · ${r.repasse ? "repassou" : "não repassou"}`}
      </div>
      {r.resposta && <p className="rounded-[8px] border border-line-2 bg-surface px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{r.resposta}</p>}
      {juiz.length > 0 && (
        <p className="text-[11.5px] text-ink-3">
          Juiz (só informa): {juiz.map(([k, v]) => `${k} ${typeof v === "number" ? v : String(v)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

const COLS = "@4xl:grid-cols-[16px_minmax(0,1fr)_88px_92px_92px_120px]";

function Comparacao({ d, base, candidata }: { d: DetalheAgente; base: Rodada; candidata: Rodada }) {
  const [filtro, setFiltro] = useState<"mudou" | "falhas" | "todos">("mudou");
  const linhas = useMemo(() => {
    const ra = new Map(d.resultados.filter((x) => x.rodada === base.id).map((x) => [x.slug, x]));
    const rb = new Map(d.resultados.filter((x) => x.rodada === candidata.id).map((x) => [x.slug, x]));
    return [...new Set([...ra.keys(), ...rb.keys()])]
      .map((slug) => {
        const a = ra.get(slug);
        const b = rb.get(slug);
        return { slug, a, b, criticidade: (b ?? a)!.criticidade, mudanca: mudancaDe(a, b) };
      })
      .sort((x, y) => MUDANCA[x.mudanca].ordem - MUDANCA[y.mudanca].ordem || (x.criticidade === "critico" ? -1 : 0) - (y.criticidade === "critico" ? -1 : 0) || x.slug.localeCompare(y.slug));
  }, [d.resultados, base.id, candidata.id]);
  const mudou = linhas.filter((l) => l.mudanca !== "passa" && l.mudanca !== "falha");
  const falhas = linhas.filter((l) => l.b && !l.b.passou);
  const visiveis = filtro === "mudou" ? mudou : filtro === "falhas" ? falhas : linhas;
  const quebrou = linhas.filter((l) => l.mudanca === "quebrou");

  return (
    <>
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {[
          { r: base, titulo: "Base" },
          { r: candidata, titulo: "Candidata" },
        ].map(({ r, titulo }, i) => (
          <Card key={titulo} className={cn("p-4", i === 1 && "@3xl:col-start-3")}>
            <div className="text-[11.5px] text-ink-3">{titulo}</div>
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <span className="inline-flex items-baseline gap-2">
                <Mono className="text-[14px] text-ink">v{versaoCurta(r.hash)}</Mono>
                <span className="text-[12px] text-ink-3">{rotuloDaVersao(d, r.hash)}</span>
              </span>
              <ResultadoRodada r={r} minima={d.resumo.metas.aprovacao_minima} />
            </div>
            <div className="mt-1.5 text-[11.5px] text-ink-3">
              {MOTIVO_RODADA[r.motivo] ?? r.motivo} · {dataHora(r.concluidaEm ?? r.criadoEm)}
              {r.criticosFalhos.length > 0 && <span className="text-crit-ink"> · críticos falhando: {r.criticosFalhos.join(", ")}</span>}
            </div>
          </Card>
        ))}
        <div className="hidden flex-col items-center justify-center gap-1 @3xl:col-start-2 @3xl:row-start-1 @3xl:flex">
          <ArrowRight className="size-4 text-ink-4" />
          {base.aprovacao !== null && candidata.aprovacao !== null && <Delta value={(candidata.aprovacao - base.aprovacao) * 100} unit=" pts" />}
        </div>
      </div>

      <div className="mt-5 mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Casos da comparação"
          value={filtro}
          onChange={setFiltro}
          options={[
            { value: "mudou", label: "O que mudou", count: mudou.length },
            { value: "falhas", label: "Falham na candidata", count: falhas.length },
            { value: "todos", label: "Todos", count: linhas.length },
          ]}
        />
        <span className="text-[12px] text-ink-3">
          {quebrou.length ? `${plural(quebrou.length, "caso quebrou", "casos quebraram")} da base para a candidata` : "nenhum caso quebrou da base para a candidata"}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className={cn("hidden gap-x-4 border-b border-line bg-sunken px-5 py-2 text-[11.5px] font-medium text-ink-3 @4xl:grid", COLS)}>
          <span />
          <span>Caso</span>
          <span>Criticidade</span>
          <span>Base</span>
          <span>Candidata</span>
          <span className="text-right">Mudança</span>
        </div>
        {visiveis.length ? (
          <div className="divide-y divide-line">
            {visiveis.map((l) => (
              <details key={l.slug} className="group">
                <summary
                  className={cn(
                    "grid cursor-pointer list-none grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-subtle [&::-webkit-details-marker]:hidden",
                    COLS,
                  )}
                >
                  <ChevronRight className="size-3.5 text-ink-3 transition-transform group-open:rotate-90" />
                  <Mono className="truncate text-ink">{l.slug}</Mono>
                  <span className="hidden @4xl:block">{l.criticidade === "critico" ? <StatusChip status="crit" label="Crítico" /> : <Pill>normal</Pill>}</span>
                  {[l.a, l.b].map((x, i) => (
                    <span key={i} className="hidden items-center gap-1.5 text-[12px] text-ink-2 @4xl:inline-flex">
                      {x ? (
                        <>
                          <StatusDot status={x.passou ? "ok" : x.criticidade === "critico" ? "crit" : "serious"} className="size-1.5" />
                          {x.passou ? "passou" : "falhou"}
                        </>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </span>
                  ))}
                  <span className={cn("text-right text-[12px]", l.mudanca === "quebrou" ? "font-medium text-crit-ink" : l.mudanca === "consertou" ? "text-ok-ink" : "text-ink-3")}>
                    {MUDANCA[l.mudanca].label}
                  </span>
                </summary>
                <div className="grid gap-3 px-5 pt-1 pb-5 @4xl:grid-cols-2 @4xl:pl-[52px]">
                  <Lado r={l.a} titulo={`Base · v${versaoCurta(base.hash)}`} />
                  <Lado r={l.b} titulo={`Candidata · v${versaoCurta(candidata.hash)}`} />
                </div>
              </details>
            ))}
          </div>
        ) : (
          <EmptyState title={filtro === "mudou" ? "Nada mudou entre as duas rodadas" : "Nenhum caso com esse filtro"} />
        )}
      </Card>
      <p className="mt-3 text-[11.5px] text-ink-3">
        As respostas são do ensaio: a entrada do caso é anonimizada e a rodada não envia WhatsApp nem grava agendamento de verdade.
      </p>
    </>
  );
}

/** Rodadas: o que a última mudança quebrou, caso a caso, e o histórico de rodadas do agente. */
export function RodadasDoAgente({ d }: { d: DetalheAgente }) {
  const concluidas = d.rodadas.filter((r) => r.status === "concluida" && d.resultados.some((x) => x.rodada === r.id));
  const padrao = escolhaPadrao(d, concluidas);
  const [baseId, setBase] = useState(padrao.base);
  const [candId, setCand] = useState(padrao.candidata);
  const base = concluidas.find((r) => r.id === baseId);
  const candidata = concluidas.find((r) => r.id === candId);

  if (!d.rodadas.length) {
    return (
      <Card>
        <EmptyState
          icon={<FlaskConical className="size-5" />}
          title="Nenhuma rodada ainda"
          description="Uma rodada roda os casos ativos contra uma versão do agente no n8n, em ensaio. Ela é pedida aqui, pelo gate antes de publicar, ou depois de cada publicação."
        />
      </Card>
    );
  }

  return (
    <>
      <Section title="Comparação lado a lado" description="Duas rodadas, caso a caso: o que a mudança quebrou e o que consertou">
        {concluidas.length >= 2 && base && candidata ? (
          <>
            <div className="mb-4 grid gap-3 @3xl:grid-cols-2">
              {[
                { rotulo: "Base", valor: baseId, set: setBase },
                { rotulo: "Candidata", valor: candId, set: setCand },
              ].map((s) => (
                <label key={s.rotulo} className="block">
                  <span className="text-[12px] text-ink-3">{s.rotulo}</span>
                  <select
                    value={s.valor}
                    onChange={(e) => s.set(e.target.value)}
                    className="mt-1 h-8 w-full rounded-[8px] border border-line-2 bg-sunken px-2.5 text-[12.5px] text-ink outline-none focus:border-ink-4"
                  >
                    {concluidas.map((r) => (
                      <option key={r.id} value={r.id}>
                        {opcaoDeRodada(d, r)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {base.id === candidata.id ? (
              <Card>
                <EmptyState title="Escolha duas rodadas diferentes" />
              </Card>
            ) : (
              <Comparacao key={`${base.id}:${candidata.id}`} d={d} base={base} candidata={candidata} />
            )}
          </>
        ) : (
          <Card>
            <EmptyState title="Uma rodada concluída só" description="A comparação aparece quando houver duas rodadas concluídas (por exemplo, a versão no ar e o rascunho)." />
          </Card>
        )}
      </Section>

      <Section title="Histórico" description="Cada rodada pedida para o agente, da mais recente para a mais antiga">
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {d.rodadas.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
                <StatusChip status={STATUS_RODADA[r.status].status} label={STATUS_RODADA[r.status].label} pulse={r.status === "rodando"} className="w-[100px] justify-center" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <Mono className="text-ink">v{versaoCurta(r.hash)}</Mono>
                    <span className="text-[12px] text-ink-3">{rotuloDaVersao(d, r.hash)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
                    {MOTIVO_RODADA[r.motivo] ?? r.motivo}
                    {r.pedidaPor && ` · ${r.pedidaPor}`}
                    {r.executor && ` · ${r.executor}`}
                    {r.erro && <span className="text-crit-ink"> · {r.erro}</span>}
                  </span>
                </span>
                {r.status === "concluida" && (
                  <span className="flex items-center gap-4">
                    <ResultadoRodada r={r} minima={d.resumo.metas.aprovacao_minima} />
                    {r.criticosFalhos.length > 0 && <span className="text-[12px] text-crit-ink">{plural(r.criticosFalhos.length, "crítico falhou", "críticos falharam")}</span>}
                  </span>
                )}
                <span className="w-[88px] text-right text-[12px] text-ink-3 tnum" title={dataHora(r.concluidaEm ?? r.criadoEm)}>
                  {relativo(r.concluidaEm ?? r.criadoEm, d.agora)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>
    </>
  );
}

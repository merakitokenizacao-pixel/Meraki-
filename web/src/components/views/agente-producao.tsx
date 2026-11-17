"use client";

import { useMemo } from "react";
import { Activity, MessageSquareWarning } from "lucide-react";
import { TimeSeriesChart, type TMarker } from "@/components/charts/time-series";
import { Card, CardHeader, Section } from "@/components/ui/card";
import { EmptyState, Mono, Pill } from "@/components/ui/misc";
import { StatCard } from "@/components/ui/stat";
import { type DetalheAgente, MINIMO_CONVERSAS, type MetricaDiaria, type Publicacao, daVersao, recentesDaVersao, somarProducao, versaoCurta } from "@/lib/plataforma/modelo";
import { dataHora, diaCurto } from "@/lib/tempo";
import { fmtDec, fmtInt, fmtMs } from "@/lib/format";
import { setSearchParam } from "@/lib/url";
import { cn } from "@/lib/utils";
import { Bloco } from "./comum";
import { estadoDoRepasse, pct, suficiente, taxa } from "./agente-comum";

const FUSO = "America/Sao_Paulo";
const diaDe = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: FUSO });
const DIA = 86_400_000;

/** Dias contínuos entre o primeiro e o último (AAAA-MM-DD), sem depender do fuso de quem vê. */
function diasEntre(primeiro: string, ultimo: string) {
  const dias: string[] = [];
  for (let t = Date.parse(`${primeiro}T12:00:00Z`); ; t += DIA) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d > ultimo) break;
    dias.push(d);
  }
  return dias;
}

/** Soma do dia em todas as versões (no dia da troca, duas versões dividem o dia). */
function porDia(ms: MetricaDiaria[]) {
  const mapa = new Map<string, MetricaDiaria[]>();
  for (const m of ms) mapa.set(m.dia, [...(mapa.get(m.dia) ?? []), m]);
  return mapa;
}

function LinhaVersao({ p, ms, atual, d }: { p: Publicacao; ms: MetricaDiaria[]; atual: boolean; d: DetalheAgente }) {
  const s = somarProducao(ms.filter((m) => !m.incerta));
  const ok = suficiente(s);
  const incertos = ms.filter((m) => m.incerta).length;
  const metaP95 = d.resumo.metas.latencia_p95_ms;
  return (
    <li className={cn("grid grid-cols-2 items-center gap-x-4 gap-y-2 px-5 py-3 text-[12.5px] @4xl:grid-cols-[minmax(0,1.3fr)_repeat(6,minmax(0,0.7fr))]", atual && "bg-subtle/60")}>
      <span className="col-span-2 min-w-0 @4xl:col-span-1">
        <span className="flex items-center gap-2">
          <Mono className="text-ink">v{versaoCurta(p.hash)}</Mono>
          {atual && <Pill className="h-[18px] px-1.5 text-[10.5px]">no ar</Pill>}
          {incertos > 0 && (
            <span className="text-[11px] text-ink-3" title="A troca de versão foi vista pela coleta: os dias entre a publicação e a coleta podem ser de qualquer uma das duas, e ficam fora das taxas (como nas regras P1 e P5).">
              {incertos === 1 ? "1 dia incerto fora da conta" : `${incertos} dias incertos fora da conta`}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[11.5px] text-ink-3">
          {dataHora(p.inicioMinimo ?? p.inicio)} → {p.fim ? dataHora(p.fim) : "agora"}
        </span>
      </span>
      <span className="tnum text-ink-2">
        <span className="text-ink-3 @4xl:hidden">Conversas </span>
        {fmtInt(s.conversas)}
      </span>
      <span className="tnum text-ink-2">
        <span className="text-ink-3 @4xl:hidden">Repasse </span>
        {ok ? pct(taxa(s.repasses, s.conversas)) : <span className="text-ink-4">dados insuficientes</span>}
      </span>
      <span className="tnum text-ink-2">
        <span className="text-ink-3 @4xl:hidden">Conversão </span>
        {ok ? pct(taxa(s.conversoes, s.conversas)) : <span className="text-ink-4">—</span>}
      </span>
      <span className="tnum text-ink-2">
        <span className="text-ink-3 @4xl:hidden">Violações </span>
        {fmtInt(s.violacoes)}
      </span>
      <span className="tnum text-ink-2">
        <span className="text-ink-3 @4xl:hidden">Erros </span>
        {s.execucoes ? `${pct(taxa(s.erros, s.execucoes))} de ${fmtInt(s.execucoes)}` : "—"}
      </span>
      <span className={cn("tnum", metaP95 && s.p95 !== null && s.p95 > metaP95 ? "text-serious-ink" : "text-ink-2")}>
        <span className="text-ink-3 @4xl:hidden">p95 </span>
        {s.p95 !== null ? fmtMs(s.p95) : "—"}
      </span>
    </li>
  );
}

const MAPEAMENTO = `agentes:
  <nome do agente>:
    workflow: <id do workflow>
    node: <nome do node do agente>
    conversas:
      tabela: public.mensagens        # onde fica cada mensagem da conversa
      contato: contato_id
      texto: conteudo
      momento: criado_em
      autor: { coluna: origem, agente: ia }
    eventos:
      repasse: { tabela: public.pausas, contato: contato_id, momento: criado_em }
      conversao: { tabela: public.agendamentos, contato: contato_id, momento: criado_em, janela_dias: 7 }`;

/** Produção: a versão nova melhorou ou piorou no uso real. Só agregados; a conversa é buscada ao vivo e não fica gravada. */
export function ProducaoDoAgente({ d }: { d: DetalheAgente }) {
  const a = d.resumo;
  const metas = a.metas;
  const { labels, repasse, p95, marcas, dias } = useMemo(() => {
    if (!d.metricas.length) return { labels: [], repasse: [], p95: [], marcas: [] as TMarker[], dias: [] as string[] };
    const mapa = porDia(d.metricas);
    const todos = [...mapa.keys()].sort();
    const dias = diasEntre(todos[0], todos.at(-1)!).slice(-45);
    const repasse = dias.map((dia) => {
      const s = somarProducao(mapa.get(dia) ?? []);
      return s.conversas ? Number(((s.repasses / s.conversas) * 100).toFixed(1)) : null;
    });
    const p95 = dias.map((dia) => {
      const s = somarProducao(mapa.get(dia) ?? []);
      return s.p95 !== null ? Number((s.p95 / 1000).toFixed(2)) : null;
    });
    const marcas: TMarker[] = d.publicacoes
      .map((p) => ({ index: dias.indexOf(diaDe(p.inicio)), label: `v${versaoCurta(p.hash)}` }))
      .filter((m) => m.index > 0);
    return { labels: dias.map(diaCurto), repasse, p95, marcas, dias };
  }, [d.metricas, d.publicacoes]);

  const doHash = (h: string | null) => d.metricas.filter((m) => m.hash === h);
  // Atual e anterior como em publicacoesDe (motor): a comparação é a mesma das regras P1 e P5.
  const atual = d.publicacoes.find((p) => !p.fim) ?? d.publicacoes.at(-1);
  const anterior = atual ? [...d.publicacoes].reverse().find((p) => p !== atual && p.hash !== atual.hash && p.inicio < atual.inicio) : undefined;
  const hashAtual = atual?.hash ?? a.versao;
  const sAtual = somarProducao(daVersao(d.metricas, hashAtual));
  const sAnterior = anterior ? somarProducao(daVersao(d.metricas, anterior.hash)) : null;
  const tAtual = suficiente(sAtual) ? taxa(sAtual.repasses, sAtual.conversas) : null;
  const tAnterior = sAnterior && suficiente(sAnterior) ? taxa(sAnterior.repasses, sAnterior.conversas) : null;
  // Últimos 7 dias da versão no ar, como as regras P2–P4, a partir do "agora" que veio do servidor com os dados.
  const recentes = recentesDaVersao(d.metricas, hashAtual, d.agora);
  const semana = somarProducao(recentes);
  const exemplos = recentes
    .filter((m) => m.exemplos.length)
    .sort((x, y) => y.dia.localeCompare(x.dia))
    .flatMap((m) => m.exemplos.map((id) => ({ id, dia: m.dia, hash: m.hash })))
    .slice(0, 20);
  const total = somarProducao(d.metricas.filter((m) => dias.includes(m.dia)));

  if (!d.metricas.length && !a.conversasMapeadas) {
    return (
      <Card>
        <EmptyState
          icon={<Activity className="size-5" />}
          title="Sem produção medida"
          description="O Meraki mede repasse, conversão e violações direto no banco do projeto, pela tabela das conversas. Declare no contrato onde ela fica. Memória só no Redis não serve: sem tabela de conversa não há métrica de produção."
        />
        <div className="px-5 pb-5">
          <Bloco className="max-h-none">{MAPEAMENTO}</Bloco>
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Repasse · versão no ar"
          value={tAtual === null ? "—" : pct(tAtual)}
          status={tAtual === null ? undefined : estadoDoRepasse(sAtual, metas.repasse_maximo)}
          delta={tAtual !== null && tAnterior !== null ? (tAtual - tAnterior) * 100 : undefined}
          deltaUnit=" pts"
          goodWhen="down"
          foot={
            !a.conversasMapeadas
              ? "conversas não mapeadas no contrato"
              : tAtual === null
                ? `${fmtInt(sAtual.conversas)} conversas · dados insuficientes (mínimo ${MINIMO_CONVERSAS})`
                : tAnterior !== null
                  ? `vs v${versaoCurta(anterior?.hash)} (${pct(tAnterior)})`
                  : `${fmtInt(sAtual.conversas)} conversas${metas.repasse_maximo !== undefined ? ` · meta até ${pct(metas.repasse_maximo)}` : ""}`
          }
        />
        <StatCard
          label="Conversão · versão no ar"
          value={suficiente(sAtual) ? pct(taxa(sAtual.conversoes, sAtual.conversas)) : "—"}
          delta={suficiente(sAtual) && sAnterior && suficiente(sAnterior) ? ((taxa(sAtual.conversoes, sAtual.conversas) ?? 0) - (taxa(sAnterior.conversoes, sAnterior.conversas) ?? 0)) * 100 : undefined}
          deltaUnit=" pts"
          foot={
            !a.conversasMapeadas
              ? "conversas não mapeadas no contrato"
              : suficiente(sAtual)
                ? `${fmtInt(sAtual.conversoes)} de ${fmtInt(sAtual.conversas)} conversas`
                : `${fmtInt(sAtual.conversas)} conversas · dados insuficientes`
          }
        />
        <StatCard
          label="Violações de política · 7 dias"
          value={a.conversasMapeadas ? fmtInt(semana.violacoes) : "—"}
          status={semana.violacoes ? "warn" : a.conversasMapeadas ? "ok" : undefined}
          foot={
            !a.conversasMapeadas
              ? "conversas não mapeadas no contrato"
              : semana.conversas
                ? `versão no ar · em ${fmtInt(semana.conversas)} conversas`
                : "sem conversas da versão no ar na semana"
          }
        />
        <StatCard
          label="Latência p95 · 7 dias"
          value={semana.p95 !== null ? fmtDec(semana.p95 / 1000, 1) : "—"}
          unit={semana.p95 !== null ? "s" : undefined}
          status={semana.p95 !== null && metas.latencia_p95_ms ? (semana.p95 > metas.latencia_p95_ms ? "serious" : "ok") : undefined}
          foot={`${fmtInt(semana.execucoes)} execuções${metas.latencia_p95_ms ? ` · meta ${fmtDec(metas.latencia_p95_ms / 1000, 1)} s` : ""}${semana.execucoes ? ` · ${pct(taxa(semana.erros, semana.execucoes))} com erro` : ""}`}
        />
      </div>

      {labels.length > 1 && (
        <div className="mt-9 grid gap-4 @5xl:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader
              title="Repasse para humano por dia"
              description={a.conversasMapeadas ? `% das conversas que a equipe assumiu · ${fmtInt(total.conversas)} conversas no período · marca em cada publicação` : "conversas não mapeadas no contrato"}
            />
            <div className="px-3 pb-4">
              {a.conversasMapeadas ? (
                <TimeSeriesChart
                  labels={labels}
                  series={[{ key: "repasse", name: "Repasse", color: "var(--color-s1)", data: repasse, area: true }]}
                  height={220}
                  yFormat={(v) => `${fmtDec(v, 0)}%`}
                  valueFormat={(v) => `${fmtDec(v, 1)}%`}
                  threshold={metas.repasse_maximo !== undefined ? { value: metas.repasse_maximo * 100, label: `Meta · até ${pct(metas.repasse_maximo)}` } : undefined}
                  markers={marcas}
                  yDomain={[0, "auto"]}
                />
              ) : (
                <EmptyState title="Sem conversas mapeadas" />
              )}
            </div>
          </Card>
          <Card className="min-w-0">
            <CardHeader title="Latência p95 por dia" description="Execuções do workflow no n8n, em segundos · marca em cada publicação" />
            <div className="px-3 pb-4">
              <TimeSeriesChart
                labels={labels}
                series={[{ key: "p95", name: "p95", color: "var(--color-s1)", data: p95, area: true }]}
                height={220}
                yFormat={(v) => `${fmtDec(v, v < 10 ? 1 : 0)} s`}
                valueFormat={(v) => `${fmtDec(v, 1)} s`}
                threshold={metas.latencia_p95_ms ? { value: metas.latencia_p95_ms / 1000, label: `Meta · ${fmtDec(metas.latencia_p95_ms / 1000, 1)} s` } : undefined}
                markers={marcas}
                yDomain={[0, "auto"]}
              />
            </div>
          </Card>
        </div>
      )}

      <Section title="Por versão" description={`Cada versão no período em que esteve no ar · taxas só com ${MINIMO_CONVERSAS} conversas ou mais (o mesmo corte das regras P1 e P5)`}>
        <Card className="overflow-hidden">
          <div className="hidden gap-x-4 border-b border-line bg-sunken px-5 py-2 text-[11.5px] font-medium text-ink-3 @4xl:grid @4xl:grid-cols-[minmax(0,1.3fr)_repeat(6,minmax(0,0.7fr))]">
            <span>Versão</span>
            <span>Conversas</span>
            <span>Repasse</span>
            <span>Conversão</span>
            <span>Violações</span>
            <span>Erros</span>
            <span>p95</span>
          </div>
          {d.publicacoes.length ? (
            <ul className="divide-y divide-line">
              {[...d.publicacoes].reverse().map((p) => (
                <LinhaVersao key={`${p.hash}:${p.inicio}`} p={p} ms={doHash(p.hash).filter((m) => m.dia >= diaDe(p.inicioMinimo ?? p.inicio) && (!p.fim || m.dia <= diaDe(p.fim)))} atual={!p.fim} d={d} />
              ))}
            </ul>
          ) : (
            <EmptyState title="Nenhuma publicação registrada" description="A linha do tempo de versões começa na primeira coleta que vê o agente publicado." />
          )}
        </Card>
      </Section>

      {a.conversasMapeadas && (
        <Section title="Respostas que violaram a política · 7 dias" description="Só o id da mensagem fica guardado. Ao abrir, a conversa é buscada ao vivo no banco do projeto, anonimizada, e não é gravada">
          <Card className="overflow-hidden">
            {exemplos.length ? (
              <ul className="divide-y divide-line">
                {exemplos.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => setSearchParam("conversa", x.id)}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-subtle"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-line bg-subtle text-ink-2">
                        <MessageSquareWarning className="size-4" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-ink">Resposta fora da política</span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
                          {diaCurto(x.dia)} · versão <Mono className="text-[11.5px]">v{versaoCurta(x.hash)}</Mono> · mensagem <Mono className="text-[11.5px]">{x.id.slice(0, 8)}</Mono>
                        </span>
                      </span>
                      <span className="text-[12.5px] text-ink-2">Revisar conversa</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nenhuma violação nos últimos 7 dias" description="As respostas respeitaram o tamanho, o número de perguntas e as palavras proibidas do contrato." />
            )}
          </Card>
        </Section>
      )}
    </>
  );
}

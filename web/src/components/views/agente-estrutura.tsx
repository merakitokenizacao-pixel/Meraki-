"use client";

import { Bot, CircleSlash, MessageSquareText, Settings2 } from "lucide-react";
import { type Flow, FlowDiagram, FlowLegend, type FlowNode } from "@/components/charts/flow-diagram";
import { projectHref } from "@/components/shell/nav";
import { Card, CardFooter, CardHeader, Section } from "@/components/ui/card";
import { EmptyState, Mono, Pill } from "@/components/ui/misc";
import { SevChip, StatusDot } from "@/components/ui/status";
import { estadoDosAchados } from "@/lib/plataforma/fluxo";
import { type Achado, type DetalheAgente, ROTULO_ESTADO_ACHADO, SEV, TIPO_OBJETO, type ToolDoAgente, alvoDoFluxo, semAssinatura } from "@/lib/plataforma/modelo";
import { dataHora } from "@/lib/tempo";
import { fmtInt } from "@/lib/format";
import { plural } from "@/lib/url";
import { cn } from "@/lib/utils";
import { estadoDoAgente } from "./agente-comum";
import { Bloco, MetaGrid } from "./comum";
import { ListaAchados } from "./lista-achados";

/** Fundo pontilhado discreto da área do diagrama (o mesmo de Sistemas). */
const CANVAS: React.CSSProperties = {
  backgroundImage: "radial-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px)",
  backgroundSize: "18px 18px",
  backgroundPosition: "center",
};

const tipoCurto = (t: string | null | undefined) => (t ? (t.split(".").pop() ?? t) : "—");
const simNao = (v: boolean) => (v ? "Sim" : "Não");

/** Achados abertos indexados pelo outro objeto do achado (a tool, a tabela, a função), sem a assinatura. */
function achadosPorPar(achados: Achado[]) {
  const mapa = new Map<string, Achado[]>();
  for (const a of achados) {
    if (a.status !== "aberto" || !a.par) continue;
    const k = semAssinatura(a.par);
    mapa.set(k, [...(mapa.get(k) ?? []), a]);
  }
  return mapa;
}

const chaveDaTool = (d: DetalheAgente, t: ToolDoAgente) => `n8n:node:${d.resumo.workflow.id}/${t.node}`;

/** Do gatilho ao banco: o que dispara o agente, as tools que ele tem e o que cada tool alcança. */
function fluxoDoAgente(d: DetalheAgente): Flow {
  const a = d.resumo;
  const porPar = achadosPorPar(d.achados);
  const doPar = (k: string) => porPar.get(semAssinatura(k));
  const sub = (lista: Achado[] | undefined, padrao: string) => {
    const estado = estadoDosAchados(lista);
    const pior = lista?.find((x) => SEV[x.severidade].status === estado);
    return pior ? `${pior.regra} · ${pior.regraTitulo ?? pior.titulo}` : padrao;
  };
  const detalhe = (k: string) => `${projectHref(d.projeto.slug)}?objeto=${encodeURIComponent(k)}`;

  const gatilhos: FlowNode[] = d.gatilhos.map((g) => ({
    id: `gatilho:${g}`,
    title: g,
    sub: "gatilho do workflow",
    icon: "node",
    href: detalhe(`n8n:node:${a.workflow.id}/${g}`),
  }));
  const agente: FlowNode = {
    id: a.chave,
    title: a.nome,
    sub: [a.modelo ?? "sem modelo", d.memoria ? `memória ${tipoCurto(d.memoria.tipo).replace(/^memory/, "")}` : "sem memória"].join(" · "),
    icon: "agente",
    status: a.pior ? estadoDoAgente(a) : null,
    href: detalhe(a.chave),
  };
  const tools: FlowNode[] = d.ferramentas.map((t) => {
    const k = chaveDaTool(d, t);
    const lista = doPar(k);
    return {
      id: k,
      title: t.nome,
      sub: sub(lista, t.desativada ? "desativada" : t.opaca ? "opaca · o Meraki não vê o que ela toca" : plural(t.alvos.length, "alvo no banco", "alvos no banco")),
      icon: "node",
      mono: true,
      status: estadoDosAchados(lista),
      dashed: t.opaca || t.desativada,
      href: detalhe(k),
    };
  });
  const alvos: FlowNode[] = d.alvos.map((x) => {
    const lista = doPar(x.chave);
    return {
      id: x.chave,
      title: x.nome,
      sub: sub(lista, x.existe ? (TIPO_OBJETO[x.tipo] ?? x.tipo) : `${TIPO_OBJETO[x.tipo] ?? "Objeto"} · não existe no banco`),
      icon: x.tipo,
      mono: true,
      status: estadoDosAchados(lista),
      dashed: !x.existe,
      href: x.existe ? detalhe(x.chave) : undefined,
    };
  });

  const edges = [
    ...gatilhos.map((g) => ({ from: g.id, to: agente.id, label: "dispara" })),
    ...tools.map((t) => ({ from: agente.id, to: t.id, label: "usa" })),
    ...d.ferramentas.flatMap((t) =>
      [...new Set(t.alvos.map(alvoDoFluxo))].map((k) => ({ from: chaveDaTool(d, t), to: k, label: "alcança" })),
    ),
  ];
  const columns = [
    ...(gatilhos.length ? [{ title: "Gatilho", nodes: gatilhos }] : []),
    { title: "Agente", nodes: [agente] },
    { title: "Tools", nodes: tools },
    ...(alvos.length ? [{ title: "Alcança", nodes: alvos }] : []),
  ];
  return {
    title: "Do gatilho ao banco",
    description: "O que dispara o agente, as tools ligadas a ele e o que cada tool lê, grava ou chama · clique para abrir o detalhe em Sistemas",
    columns,
    edges,
  };
}

function CartaoPrompt({ d }: { d: DetalheAgente }) {
  const p = d.prompt;
  const hist = d.promptHistorico;
  const anterior = [...hist].reverse().find((h) => p && h.tamanho !== p.tamanho);
  const cresceu = p && anterior ? (p.tamanho - anterior.tamanho) / Math.max(anterior.tamanho, 1) : null;
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader icon={<MessageSquareText />} title="Prompt da versão no ar" description="Mensagem de sistema que o modelo recebe e a entrada de cada execução" />
      {p ? (
        <div className="space-y-4 px-5 pb-5">
          <MetaGrid
            items={[
              { label: "Tamanho", value: `${fmtInt(p.tamanho)} caracteres` },
              { label: "Exemplos literais", value: fmtInt(p.exemplos) },
              { label: "Lê $json direto", value: simNao(p.leJson) },
              {
                label: "Desde a versão anterior",
                value: cresceu === null ? "—" : `${cresceu > 0 ? "+" : "−"}${fmtInt(Math.abs(Math.round(cresceu * 100)))}% (${fmtInt(anterior!.tamanho)} → ${fmtInt(p.tamanho)})`,
              },
            ]}
          />
          <Bloco className="max-h-[360px] whitespace-pre-wrap">{p.sistema || "(sem mensagem de sistema)"}</Bloco>
          <div>
            <div className="text-[11.5px] text-ink-3">Entrada de cada execução</div>
            <Mono className="mt-1 block break-all text-[12px]">{p.entrada || "—"}</Mono>
          </div>
        </div>
      ) : (
        <EmptyState title="Prompt não coletado" description="A próxima coleta do n8n traz o prompt do agente." />
      )}
    </Card>
  );
}

function CartaoConfiguracao({ d }: { d: DetalheAgente }) {
  const a = d.resumo;
  const pol = d.config?.politicas;
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader icon={<Settings2 />} title="Modelo, memória e ensaio" description="O que muda o comportamento além do prompt" />
      <div className="space-y-5 px-5 pb-5">
        <MetaGrid
          cols={2}
          items={[
            { label: "Modelo", value: a.modelo ?? "—" },
            { label: "Fallback", value: a.fallback ?? "nenhum" },
            {
              label: "Memória",
              value: d.memoria ? (
                <span title={d.memoria.tipo}>
                  {tipoCurto(d.memoria.tipo)}
                  {d.memoria.tabela && <Mono className="ml-1 text-[11.5px]">{d.memoria.tabela}</Mono>}
                </span>
              ) : (
                "nenhuma"
              ),
            },
            { label: "Chave da sessão", value: d.memoria?.sessao ? <Mono className="text-[11.5px]">{d.memoria.sessao}</Mono> : "—" },
            { label: "Parser de saída", value: d.parser ? tipoCurto(d.parser.tipo) : "nenhum" },
            { label: "Entrada ramificada", value: simNao(d.entradaRamificada) },
            { label: "Avaliação no n8n", value: d.avaliacaoNativa ? "Evaluation Trigger presente" : "sem gatilho de avaliação" },
            { label: "Desvio do ensaio", value: d.desviaEnsaio ? "checkIfEvaluating antes de enviar" : "não desvia" },
          ]}
        />
        <div className="rounded-[7px] border border-line bg-subtle px-4 py-3">
          <div className="text-[12px] font-medium text-ink-2">Política das respostas (contrato)</div>
          {d.config ? (
            <dl className="mt-2 grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-3">
              <div>
                <dt className="text-[11.5px] text-ink-3">Palavras proibidas</dt>
                <dd className="mt-0.5 text-ink-2">{pol?.proibidas?.length ? pol.proibidas.join(", ") : "nenhuma"}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-ink-3">Tamanho máximo</dt>
                <dd className="mt-0.5 text-ink-2 tnum">{pol?.max_caracteres ? `${fmtInt(pol.max_caracteres)} caracteres` : "—"}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-ink-3">Perguntas por resposta</dt>
                <dd className="mt-0.5 text-ink-2 tnum">{pol?.max_perguntas ?? "—"}</dd>
              </div>
              <div className="sm:col-span-3">
                <dt className="text-[11.5px] text-ink-3">Parâmetro de ensaio</dt>
                <dd className="mt-0.5 text-ink-2">
                  {d.config.ensaio?.parametro ? (
                    <>
                      <Mono className="text-[11.5px]">{d.config.ensaio.parametro}</Mono> · funções que gravam recebem esse parâmetro na rodada e não gravam de verdade
                    </>
                  ) : (
                    "não declarado"
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-ink-3">Agente fora do contrato: sem política nem metas. Declare em agentes no contrato.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function TabelaTools({ d }: { d: DetalheAgente }) {
  const porPar = achadosPorPar(d.achados);
  const COLS = "@4xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)]";
  if (!d.ferramentas.length) {
    return (
      <Card>
        <EmptyState icon={<CircleSlash className="size-5" />} title="Nenhuma tool ligada" description="O agente só conversa: não consulta nem grava nada." />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className={cn("hidden gap-x-4 border-b border-line bg-sunken px-5 py-2 text-[11.5px] font-medium text-ink-3 @4xl:grid", COLS)}>
        <span>Tool</span>
        <span>Descrição que o modelo lê</span>
        <span>Argumentos do modelo</span>
        <span>Alcança</span>
      </div>
      <ul className="divide-y divide-line">
        {d.ferramentas.map((t) => {
          const lista = porPar.get(semAssinatura(chaveDaTool(d, t))) ?? [];
          return (
            <li key={t.node} className={cn("grid grid-cols-1 gap-x-4 gap-y-2 px-5 py-3.5", COLS)}>
              <span className="min-w-0">
                <Mono className="block truncate text-ink" title={t.node}>
                  {t.nome}
                </Mono>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] text-ink-3">{tipoCurto(t.tipo)}</span>
                  {t.opaca && <Pill className="h-[18px] px-1.5 text-[10.5px]">opaca</Pill>}
                  {t.desativada && <Pill className="h-[18px] px-1.5 text-[10.5px]">desativada</Pill>}
                  {lista.map((x) => (
                    <span key={x.id} className="inline-flex items-center gap-1 text-[11.5px] text-ink-3" title={x.titulo}>
                      <StatusDot status={SEV[x.severidade].status} className="size-1.5" />
                      {x.regra}
                    </span>
                  ))}
                </span>
              </span>
              <span className="min-w-0 text-[12.5px] leading-relaxed text-ink-2">{t.descricao || <span className="text-ink-4">sem descrição</span>}</span>
              <span className="min-w-0 text-[12px] text-ink-2">
                {t.argumentos.length ? (
                  t.argumentos.map((g) => (
                    <Mono key={g.nome} className="mr-1.5 inline-block text-[11.5px]" title={g.descricao}>
                      {g.nome}
                    </Mono>
                  ))
                ) : (
                  <span className="text-ink-4">nenhum</span>
                )}
              </span>
              <span className="min-w-0 text-[12px] text-ink-2">
                {t.opaca ? (
                  <span className="text-ink-3">não dá para ver</span>
                ) : t.alvos.length ? (
                  t.alvos.map((k) => (
                    <Mono key={k} className="block truncate text-[11.5px]" title={k}>
                      {k.split(":").slice(2).join(":").replace(/\(\*\)$/, "()")}
                    </Mono>
                  ))
                ) : (
                  <span className="text-ink-4">nada no banco</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Rascunho({ d }: { d: DetalheAgente }) {
  const a = d.resumo;
  if (!a.divergente) return null;
  const r = d.rascunho;
  const barram = r?.achados.filter((x) => x.bloqueia).length ?? 0;
  return (
    <Section
      title={`Rascunho v${a.rascunho?.slice(0, 8)} · ainda não está no ar`}
      description="O pacote agente roda no rascunho a cada coleta. É isto que o gate de publicação vê quando alguém tenta publicar"
    >
      <Card className="overflow-hidden">
        {!r ? (
          <EmptyState title="Rascunho ainda não avaliado" description="A próxima coleta do n8n avalia o rascunho." />
        ) : r.achados.length ? (
          <>
            <ul className="divide-y divide-line">
              {r.achados.map((x, i) => (
                <li key={`${x.regra}:${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-5 py-3">
                  <SevChip sev={x.severidade} />
                  <Mono className="pt-0.5 text-[11.5px] text-ink-3">{x.regra}</Mono>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ink">{x.titulo}</span>
                    {x.detalhe && <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">{x.detalhe}</span>}
                  </span>
                  <span className="flex gap-1.5">
                    {x.novo && <Pill>novo neste rascunho</Pill>}
                    {x.bloqueia && <Pill className="border-crit/40 text-crit-ink">barra a publicação</Pill>}
                  </span>
                </li>
              ))}
            </ul>
            <CardFooter>
              <span className="text-[12px] text-ink-3">
                {plural(r.achados.length, "achado", "achados")} · {barram ? `${plural(barram, "barra", "barram")} a publicação` : "nenhum barra a publicação"}
              </span>
              <span className="text-[12px] text-ink-3">avaliado {dataHora(r.avaliadoEm)}</span>
            </CardFooter>
          </>
        ) : (
          <EmptyState title="Nenhum achado no rascunho" description="O pacote agente não encontrou problema. A publicação ainda depende da rodada de avaliação." />
        )}
      </Card>
    </Section>
  );
}

export function EstruturaDoAgente({ d }: { d: DetalheAgente }) {
  const flow = fluxoDoAgente(d);
  return (
    <>
      <Section title={flow.title} description={flow.description}>
        <Card className="overflow-hidden">
          <div className="px-5 pt-5 pb-6" style={CANVAS}>
            <FlowDiagram flow={flow} />
          </div>
          <CardFooter className="flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
              <Bot className="size-3.5" />
              {plural(d.ferramentas.length, "tool", "tools")} · {plural(d.alvos.length, "objeto alcançado", "objetos alcançados")}
              {d.alvos.some((x) => !x.existe) && ` · ${plural(d.alvos.filter((x) => !x.existe).length, "não existe no banco", "não existem no banco")}`}
            </span>
            <FlowLegend flow={flow} labels={ROTULO_ESTADO_ACHADO} />
          </CardFooter>
        </Card>
      </Section>

      <div className="mt-9 grid gap-4 @5xl:grid-cols-2">
        <CartaoPrompt d={d} />
        <CartaoConfiguracao d={d} />
      </div>

      <Section title="Tools" description="O nome e a descrição são o que o modelo lê para decidir quando chamar · os argumentos vêm do $fromAI">
        <TabelaTools d={d} />
      </Section>

      <Rascunho d={d} />

      <Section title="Achados do agente" description="Pacotes agente, avaliação e produção · valem para a versão no ar · clique para ver a evidência">
        <ListaAchados achados={d.achados} agora={d.agora} />
      </Section>
    </>
  );
}

import Link from "next/link";
import { FileCheck, Inbox } from "lucide-react";
import { projectHref } from "@/components/shell/nav";
import { Card, CardFooter, CardHeader, Section } from "@/components/ui/card";
import { EmptyState, Mono, Pill } from "@/components/ui/misc";
import { StatCard } from "@/components/ui/stat";
import { SevChip, StatusChip } from "@/components/ui/status";
import { type ContratoConteudo, type DadosContrato, type Proposta, type ResumoProjeto, STATUS_PROPOSTA, TIPO_PROPOSTA, nomeDaChave, refCurta } from "@/lib/plataforma/modelo";
import type { Status } from "@/lib/types";
import { dataHora, diaLongo, diasAte, relativo } from "@/lib/tempo";
import { fmtInt } from "@/lib/format";
import { plural } from "@/lib/url";
import { cn } from "@/lib/utils";
import { Bloco, fmtCobertura } from "./comum";
import { DecisaoProposta } from "./decisao-proposta";

/** Ref do contrato (public.contatos, fn:public.f) → link para o objeto no inventário do projeto. */
function RefLink({ slug, r, className }: { slug: string; r: string; className?: string }) {
  return (
    <Link
      href={`${projectHref(slug)}?objeto=${encodeURIComponent(r)}`}
      className={cn("font-mono text-[12px] text-ink underline-offset-2 hover:underline", className)}
      title="Abrir no inventário"
    >
      {r}
    </Link>
  );
}

function Linha({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-3 py-2.5 text-[12.5px] first:pt-0 last:pb-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">{children}</dd>
    </div>
  );
}

function PropostaAberta({ p, agora }: { p: Proposta; agora: number }) {
  const declaracao = p.declaracao?.primitiva ? `primitiva ${p.declaracao.primitiva}` : p.declaracao?.papel;
  return (
    <Card className="flex flex-col">
      <div className="px-5 pt-[18px] pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status="warn" label={STATUS_PROPOSTA.aberta.label} />
          <Pill>{TIPO_PROPOSTA[p.tipo] ?? p.tipo}</Pill>
          <span className="text-[12px] text-ink-3">
            {p.origem === "agente" ? "agente" : "equipe"}
            {p.sessao && (
              <>
                {" "}
                · sessão <span className="font-mono">{p.sessao}</span>
              </>
            )}{" "}
            · {relativo(p.criadoEm, agora)}
          </span>
        </div>
        <h3 className="mt-3 text-[14.5px] leading-snug font-medium text-ink">{p.justificativa}</h3>
        {p.resumo.length > 0 && (
          <ul className="mt-3 space-y-1">
            {p.resumo.map((r) => (
              <li key={r} className="flex gap-2 font-mono text-[12px] text-ink-2">
                <span className="text-ink-4">›</span>
                {r}
              </li>
            ))}
          </ul>
        )}
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-[11.5px] text-ink-3">Objetos</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {p.objetos.length ? (
                p.objetos.map((k) => (
                  <Pill key={k} className="font-mono text-[11px]">
                    {nomeDaChave(k)}
                  </Pill>
                ))
              ) : (
                <span className="text-[13px] text-ink-3">—</span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11.5px] text-ink-3">Declaração proposta</dt>
            <dd className="mt-1 text-[13px] text-ink-2">{declaracao ?? "nenhuma — entra como objeto declarado"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11.5px] text-ink-3">Regras que barraram</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {p.regras.length ? (
                p.regras.map((r) => (
                  <Pill key={r} className="font-mono text-[11px]">
                    {r}
                  </Pill>
                ))
              ) : (
                <span className="text-[13px] text-ink-3">—</span>
              )}
            </dd>
          </div>
        </dl>
        {p.sql && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[12.5px] text-ink-3 select-none hover:text-ink-2">SQL da migration</summary>
            <Bloco className="mt-2">{p.sql}</Bloco>
          </details>
        )}
      </div>
      <CardFooter>
        <DecisaoProposta id={p.id} origem={p.origem} />
      </CardFooter>
    </Card>
  );
}

type LinhaExcecao = { id: string; regra: string; objetos: string[]; motivo: string; ate: string; origem: string; estado: Status; rotuloEstado: string };

function Excecoes({ conteudo, d, slug }: { conteudo: ContratoConteudo | undefined; d: DadosContrato; slug: string }) {
  const vigencia = (ate: string): { estado: Status; rotulo: string } => {
    const dias = diasAte(ate, d.agora);
    return dias < 0 ? { estado: "maint", rotulo: "vencida" } : { estado: dias <= 30 ? "warn" : "ok", rotulo: dias === 0 ? "vence hoje" : `${dias} dias` };
  };
  const linhas: LinhaExcecao[] = [
    ...(conteudo?.excecoes ?? []).map((x, i) => {
      const v = vigencia(x.ate);
      return { id: `c${i}`, regra: x.regra, objetos: x.objetos, motivo: x.motivo, ate: x.ate, origem: "contrato", estado: v.estado, rotuloEstado: v.rotulo };
    }),
    ...d.excecoes.map((x) => {
      const v = x.revogadaEm ? { estado: "maint" as Status, rotulo: "revogada" } : vigencia(x.validaAte);
      return { id: x.id, regra: x.regra, objetos: [x.objeto], motivo: x.motivo, ate: x.validaAte, origem: `tela · ${x.autor}`, estado: v.estado, rotuloEstado: v.rotulo };
    }),
  ];
  return (
    <Section title="Exceções" description="Achados aceitos por um tempo: não pesam na saúde enquanto valem">
      <Card className="overflow-hidden">
        {linhas.length ? (
          <div className="divide-y divide-line">
            {linhas.map((x) => (
              <div key={x.id} className="grid gap-x-5 gap-y-2 px-5 py-3.5 @4xl:grid-cols-[72px_minmax(0,1.1fr)_minmax(0,1.4fr)_150px]">
                <span>
                  <Pill className="font-mono">{x.regra}</Pill>
                </span>
                <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
                  {x.objetos.map((k) => (
                    <RefLink key={k} slug={slug} r={refCurta(k)} />
                  ))}
                </span>
                <span className="min-w-0 text-[12.5px] leading-relaxed text-ink-2">
                  {x.motivo}
                  <span className="block text-[11.5px] text-ink-3">{x.origem}</span>
                </span>
                <span className="text-[12.5px] text-ink-2 @4xl:text-right">
                  <span className="tnum">até {diaLongo(x.ate)}</span>
                  <span className="mt-1 flex @4xl:justify-end">
                    <StatusChip status={x.estado} label={x.rotuloEstado} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Nenhuma exceção" description="Abra uma exceção pelo detalhe de um achado, com motivo e prazo." />
        )}
      </Card>
    </Section>
  );
}

/** Parte "Contrato": a intenção declarada do projeto, o que pede decisão e o histórico das versões. */
export function ContratoView({ projeto, d }: { projeto: ResumoProjeto; d: DadosContrato }) {
  const slug = projeto.slug;
  const c = d.atual?.conteudo;
  const abertas = d.propostas.filter((p) => p.status === "aberta");
  const decididas = d.propostas.filter((p) => p.status !== "aberta");
  const emVigor =
    (c?.excecoes ?? []).filter((x) => diasAte(x.ate, d.agora) >= 0).length + d.excecoes.filter((x) => !x.revogadaEm && diasAte(x.validaAte, d.agora) >= 0).length;
  const vencendo =
    (c?.excecoes ?? []).filter((x) => diasAte(x.ate, d.agora) >= 0 && diasAte(x.ate, d.agora) <= 30).length +
    d.excecoes.filter((x) => !x.revogadaEm && diasAte(x.validaAte, d.agora) >= 0 && diasAte(x.validaAte, d.agora) <= 30).length;
  const primitivas = Object.entries(c?.primitivas ?? {});
  const objetos = Object.entries(c?.objetos ?? {})
    .filter(([, o]) => o?.declarado !== false)
    .sort(([a], [b]) => a.localeCompare(b));
  const convencoes = [
    { label: "Schemas no escopo", valores: c?.escopo?.schemas },
    { label: "Ignorados", valores: c?.escopo?.ignorar },
    { label: "Parâmetro de escopo", valores: c?.convencoes?.parametro_de_escopo ? [c.convencoes.parametro_de_escopo] : [] },
    { label: "Validadores de escopo", valores: c?.convencoes?.validadores_de_escopo },
    { label: "Colunas genéricas", valores: c?.convencoes?.colunas_genericas },
    { label: "Tags do n8n", valores: c?.consumidores?.n8n_tags },
    { label: "Credenciais", valores: c?.consumidores?.credenciais },
    { label: "Papéis do banco", valores: c?.consumidores?.papeis_do_banco },
    { label: "Regras ligadas", valores: c?.regras?.ligar?.map((r) => r.replace("pacote:", "pacote ")) },
    { label: "Regras desligadas", valores: c?.regras?.desligar },
    {
      label: "Ajustes",
      valores: Object.entries(c?.regras?.ajustar ?? {}).map(
        ([regra, cfg]) =>
          `${regra}: ${Object.entries(cfg)
            .map(([k, v]) => `${k} ${String(v)}`)
            .join(", ")}`,
      ),
    },
  ].filter((x) => x.valores?.length);

  return (
    <>
      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Versão publicada"
          value={d.atual ? `v${d.atual.versao}` : "—"}
          foot={d.atual ? `${d.atual.autor} · ${relativo(d.atual.criadoEm, d.agora)}` : "Nenhuma versão publicada"}
        />
        <StatCard label="Cobertura" value={fmtCobertura(projeto.cobertura)} foot={`${fmtInt(projeto.declarados)} de ${fmtInt(projeto.avaliados)} objetos declarados`} />
        <StatCard label="Aguardando decisão" value={fmtInt(abertas.length)} status={abertas.length ? "warn" : undefined} foot="Propostas de agentes e da equipe" />
        <StatCard label="Exceções em vigor" value={fmtInt(emVigor)} foot={vencendo ? `${plural(vencendo, "vence", "vencem")} em até 30 dias` : "Nenhuma vence nos próximos 30 dias"} />
      </div>

      {!d.atual && (
        <Section title="Contrato">
          <Card>
            <EmptyState
              icon={<FileCheck className="size-5" />}
              title="Nenhum contrato publicado"
              description={
                <>
                  Gere um rascunho com <Mono>meraki contrato rascunho --projeto {slug}</Mono>, revise e publique com <Mono>meraki contrato publicar</Mono>.
                </>
              }
            />
          </Card>
        </Section>
      )}

      <Section title="Aguardando decisão" description="Aprovar publica uma nova versão; recusar devolve o motivo ao agente">
        {abertas.length ? (
          <div className="grid gap-4">
            {abertas.map((p) => (
              <PropostaAberta key={p.id} p={p} agora={d.agora} />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState icon={<Inbox className="size-5" />} title="Nada aguardando decisão" description="Propostas de agentes e da equipe aparecem aqui antes de mudar o contrato." />
          </Card>
        )}
      </Section>

      {d.naoDeclarados.length > 0 && (
        <Section
          title="Fora do contrato"
          description={
            <>
              Objetos que existem mas não foram declarados (E01) · <Mono>meraki contrato rascunho --projeto {slug}</Mono> sugere a declaração
            </>
          }
        >
          <Card className="overflow-hidden">
            <div className="divide-y divide-line">
              {d.naoDeclarados.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3">
                  <SevChip sev={a.severidade} />
                  <RefLink slug={slug} r={refCurta(a.objeto)} className="min-w-0 truncate" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{a.titulo}</span>
                  <span className="text-[12px] text-ink-3 tnum">{relativo(a.primeiroVisto, d.agora)}</span>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      {c && (
        <>
          <Section title="Primitivas" description="Conceitos do negócio: quem é dono do dado e quem pode escrever nele">
            {primitivas.length ? (
              <div className="grid gap-4 @3xl:grid-cols-2">
                {primitivas.map(([nome, p]) => (
                  <Card key={nome} className="p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[14px] font-medium text-ink">{nome}</span>
                      <Pill>primitiva</Pill>
                    </div>
                    {p.descricao && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{p.descricao}</p>}
                    <dl className="mt-4 divide-y divide-line">
                      <Linha label="Dona">
                        <RefLink slug={slug} r={p.dona} />
                      </Linha>
                      {p.vinculo && (
                        <Linha label="Vínculo">
                          <RefLink slug={slug} r={p.vinculo} />
                        </Linha>
                      )}
                      <Linha label="Escritores">{p.escritores?.length ? p.escritores.map((r) => <RefLink key={r} slug={slug} r={r} />) : "—"}</Linha>
                    </dl>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <EmptyState title="Nenhuma primitiva declarada" description="Declare em primitivas a tabela dona de cada conceito e as funções que podem escrever nela." />
              </Card>
            )}
          </Section>

          <Section title="Objetos declarados" description={`${plural(objetos.length, "objeto", "objetos")} com papel definido no contrato v${d.atual?.versao}`}>
            <Card className="overflow-hidden">
              {objetos.length ? (
                <div className="divide-y divide-line">
                  {objetos.map(([ref, o]) => (
                    <div key={ref} className="grid gap-x-5 gap-y-1 px-5 py-3 @3xl:grid-cols-[minmax(0,1fr)_200px_minmax(0,1.3fr)]">
                      <RefLink slug={slug} r={ref} className="truncate" />
                      <span className="text-[12.5px] text-ink-2">{o?.primitiva ? `primitiva ${o.primitiva}` : (o?.papel ?? "declarado")}</span>
                      <span className="text-[12.5px] text-ink-3">{o?.nota ?? (o?.proposta ? "entrou por proposta" : "—")}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Nenhum objeto declarado" description="O rascunho lista os objetos; declare papel ou primitiva de cada um para cobrir o contrato." />
              )}
            </Card>
          </Section>

          {convencoes.length > 0 && (
            <Section title="Escopo, convenções e consumidores" description="O que o motor considera do projeto e como as regras se ajustam a ele">
              <Card className="px-5 py-4">
                <dl className="divide-y divide-line">
                  {convencoes.map((x) => (
                    <Linha key={x.label} label={x.label}>
                      {x.valores!.map((v) => (
                        <Pill key={v} className="font-mono text-[11px]">
                          {v}
                        </Pill>
                      ))}
                    </Linha>
                  ))}
                </dl>
              </Card>
            </Section>
          )}
        </>
      )}

      <Excecoes conteudo={c} d={d} slug={slug} />

      <Section title="Histórico" description="Versões publicadas e propostas já decididas">
        <div className="grid gap-4 @4xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader title="Versões" description={plural(d.versoes.length, "versão", "versões")} />
            {d.versoes.length ? (
              <ol className="divide-y divide-line border-t border-line">
                {d.versoes.map((v) => (
                  <li key={v.versao} className="flex items-start gap-3 px-5 py-3">
                    <Pill className="font-mono">v{v.versao}</Pill>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] leading-relaxed text-ink-2">{v.motivo}</span>
                      <span className="mt-0.5 block text-[11.5px] text-ink-3">
                        {v.autor} · {dataHora(v.criadoEm)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="Nenhuma versão" />
            )}
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Propostas decididas" description={plural(decididas.length, "proposta", "propostas")} />
            {decididas.length ? (
              <ol className="divide-y divide-line border-t border-line">
                {decididas.map((p) => (
                  <li key={p.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip status={STATUS_PROPOSTA[p.status].status} label={STATUS_PROPOSTA[p.status].label} />
                      {p.contratoVersao !== null && p.status === "aprovada" && <Pill className="font-mono">v{p.contratoVersao}</Pill>}
                      <span className="text-[11.5px] text-ink-3">
                        {p.decididoPor ?? "—"} · {p.decididoEm ? dataHora(p.decididoEm) : "—"}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{p.justificativa}</p>
                    {p.decisaoMotivo && <p className="mt-1 text-[12px] text-ink-3">“{p.decisaoMotivo}”</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="Nenhuma proposta decidida" />
            )}
          </Card>
        </div>
      </Section>
    </>
  );
}

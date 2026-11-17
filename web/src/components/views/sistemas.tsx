import { KeyRound, TriangleAlert, Workflow } from "lucide-react";
import { FlowDiagram, FlowLegend } from "@/components/charts/flow-diagram";
import { Card, CardFooter, Section } from "@/components/ui/card";
import { EmptyState, Mono, Pill } from "@/components/ui/misc";
import { FonteIcon, IconBox } from "@/components/ui/objeto-icon";
import { StatCard } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status";
import { fluxoDoProjeto } from "@/lib/plataforma/fluxo";
import {
  type DetalheProjeto,
  type EstruturaProjeto,
  type Fonte,
  MODO_COLETA,
  ROTULO_ESTADO_ACHADO,
  SEV,
  SEVERIDADES,
  TIPO_FONTE,
  estadoDaSaude,
} from "@/lib/plataforma/modelo";
import type { Status } from "@/lib/types";
import { dataHora, relativo } from "@/lib/tempo";
import { fmtDec, fmtInt } from "@/lib/format";
import { plural } from "@/lib/url";
import { DistribuicaoSeveridade, fmtCobertura, totalAbertos } from "./comum";
import { Inventario } from "./inventario";
import { ListaAchados } from "./lista-achados";

/** Fundo pontilhado discreto da área do diagrama. */
const CANVAS: React.CSSProperties = {
  backgroundImage: "radial-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px)",
  backgroundSize: "18px 18px",
  backgroundPosition: "center",
};

const lista = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "");

/** O que a fonte lê, em uma linha — a configuração nunca guarda segredo (o segredo fica no Vault). */
function configResumo(f: Fonte) {
  const c = f.config;
  if (f.tipo === "supabase" || f.tipo === "postgres") return `schemas ${lista(c.schemas) || "public"}`;
  if (f.tipo === "n8n") return [c.tag ? `tag ${lista(c.tag)}` : null, c.exportacao ? "exportação em arquivo" : "API"].filter(Boolean).join(" · ");
  if (f.tipo === "repo") return lista(c.caminho) || lista(c.url) || "repositório";
  return "";
}

function CartaoFonte({ f, agora }: { f: Fonte; agora: number }) {
  const u = f.ultima;
  const estado: Status = !u ? "maint" : u.status === "erro" ? "crit" : u.status === "rodando" || u.avisos.length ? "warn" : "ok";
  const situacao = !u ? "Nunca coletada" : u.status === "erro" ? "Coleta com erro" : u.status === "rodando" ? "Coletando agora" : "Coleta concluída";
  const numeros = u
    ? [
        { label: "Objetos", value: u.total },
        { label: "Novos", value: u.novos },
        { label: "Alterados", value: u.alterados },
        { label: "Removidos", value: u.removidos },
      ]
    : [];
  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex items-start gap-3 px-5 pt-[18px]">
        <IconBox>
          <FonteIcon tipo={f.tipo} />
        </IconBox>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-ink">{f.nome}</span>
            {!f.ativa && <Pill>pausada</Pill>}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-ink-3" title={configResumo(f)}>
            {TIPO_FONTE[f.tipo] ?? f.tipo} · {configResumo(f)}
          </p>
        </div>
        {u?.modo && <Pill title="Modo da última coleta">{MODO_COLETA[u.modo] ?? u.modo}</Pill>}
      </div>

      {u && (
        <dl className="mt-4 grid grid-cols-4 gap-3 px-5">
          {numeros.map((n) => (
            <div key={n.label} className="min-w-0">
              <dt className="text-[11.5px] text-ink-3">{n.label}</dt>
              <dd className="mt-0.5 text-[15px] font-medium text-ink tnum">{fmtInt(n.value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {u?.status === "erro" && u.erro && <p className="mx-5 mt-4 rounded-[8px] border border-crit/30 bg-crit-soft px-3 py-2 text-[12px] text-crit-ink">{u.erro}</p>}
      {!!u?.avisos.length && (
        <ul className="mx-5 mt-4 space-y-1.5 rounded-[8px] border border-line-2 bg-subtle px-3 py-2.5">
          {u.avisos.map((a) => (
            <li key={a} className="flex gap-2 text-[12px] leading-snug text-ink-2">
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" />
              {a}
            </li>
          ))}
        </ul>
      )}

      <CardFooter className="mt-4">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3" title={u ? `Início ${dataHora(u.inicio)} · motor ${u.versaoMotor}` : undefined}>
          <StatusDot status={estado} className="size-1.5" />
          <span className="truncate">
            {situacao}
            {u && ` · ${relativo(u.inicio, agora)}`}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-ink-3">
          {f.temSegredo ? (
            <>
              <KeyRound className="size-3.5" />
              Conexão no Vault
            </>
          ) : (
            plural(f.coletas, "coleta", "coletas")
          )}
        </span>
      </CardFooter>
    </Card>
  );
}

/** Parte "Sistemas": o que existe, quem usa, o que está errado. Tudo vem da última coleta de cada fonte. */
export function SistemasView({ d, e }: { d: DetalheProjeto; e: EstruturaProjeto }) {
  const p = d.resumo;
  const total = totalAbertos(p.abertos);
  const pior = SEVERIDADES.find((s) => p.abertos[s] > 0);
  const flow = fluxoDoProjeto(e);

  return (
    <>
      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Saúde da estrutura"
          value={p.saude === null ? "—" : fmtDec(p.saude, 0)}
          unit="/ 100"
          status={estadoDaSaude(p.saude)}
          foot={p.excecoes ? `${plural(p.excecoes, "achado em exceção não pesa", "achados em exceção não pesam")}` : "Achados abertos pesam pela severidade"}
        />
        <StatCard label="Achados abertos" value={fmtInt(total)} status={pior ? SEV[pior].status : "ok"} foot={`${fmtInt(p.novos)} novos · ${fmtInt(p.herdados)} herdados`}>
          <DistribuicaoSeveridade abertos={p.abertos} className="mt-4" />
        </StatCard>
        <StatCard
          label="Cobertura do contrato"
          value={fmtCobertura(p.cobertura)}
          foot={p.contratoVersao === null ? "Nenhum contrato publicado" : `${fmtInt(p.declarados)} de ${fmtInt(p.avaliados)} objetos declarados`}
        />
        <StatCard
          label="Objetos coletados"
          value={fmtInt(p.objetos)}
          status={p.coletasComErro ? "crit" : undefined}
          foot={`${plural(p.fontes, "fonte", "fontes")}${p.coletasComErro ? ` · ${p.coletasComErro} com erro` : ""} · coleta ${relativo(p.ultimaColeta, d.agora)}`}
        />
      </div>

      <Section title="Fontes" description="De onde o motor lê a estrutura: catálogo e agregados, nunca linhas de dados de clientes">
        {d.fontes.length ? (
          <div className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
            {d.fontes.map((f) => (
              <CartaoFonte key={f.id} f={f} agora={d.agora} />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              title="Nenhuma fonte cadastrada"
              description={
                <>
                  Cadastre o banco, o n8n e o repositório do projeto e rode <Mono>meraki coletar --projeto {p.slug}</Mono>.
                </>
              }
            />
          </Card>
        )}
      </Section>

      <Section title={flow?.title ?? "Quem usa o banco"} description={flow?.description}>
        {flow ? (
          <Card className="overflow-hidden">
            <div className="px-5 pt-5 pb-6" style={CANVAS}>
              <FlowDiagram flow={flow} />
            </div>
            <CardFooter className="flex-wrap">
              <span className="text-[12px] text-ink-3">
                {plural(flow.columns[0].nodes.length, "consumidor", "consumidores")} · {plural(flow.columns[1].nodes.length, "objeto do banco", "objetos do banco")}
              </span>
              <FlowLegend flow={flow} labels={ROTULO_ESTADO_ACHADO} />
            </CardFooter>
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon={<Workflow className="size-5" />}
              title="Nenhuma relação coletada"
              description="O fluxo aparece quando o motor encontra workflows, arquivos ou papéis que leem, escrevem ou chamam objetos do banco."
            />
          </Card>
        )}
      </Section>

      <Section title="Achados" description="O que as regras encontraram neste projeto · clique para ver a evidência">
        <ListaAchados achados={e.achados} agora={e.agora} />
      </Section>

      <Section title="Inventário" description="Tudo o que foi coletado, agrupado por tipo · colunas, policies, nodes e chamadas ficam no detalhe do objeto">
        <Inventario e={e} />
      </Section>
    </>
  );
}

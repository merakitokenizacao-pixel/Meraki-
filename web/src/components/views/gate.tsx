import Link from "next/link";
import { ArrowRight, Bot, PlugZap, Workflow } from "lucide-react";
import { projectHref } from "@/components/shell/nav";
import { Card, CardHeader, Section } from "@/components/ui/card";
import { EmptyState, Mono, Pill } from "@/components/ui/misc";
import { StatCard } from "@/components/ui/stat";
import { StatusChip, StatusDot } from "@/components/ui/status";
import { DECISAO, type DadosGate, type Decisao, STATUS_PROPOSTA, TIPO_PROPOSTA } from "@/lib/plataforma/modelo";
import { dataHora, relativo } from "@/lib/tempo";
import { fmtInt } from "@/lib/format";
import { plural } from "@/lib/url";
import { Bloco } from "./comum";
import { DecisoesGate } from "./decisoes-gate";

const MES = 30 * 86_400_000;
const ORDEM: Decisao[] = ["negou", "perguntou", "permitiu"];

/** Configuração dos hooks do Claude Code no repositório do projeto (.claude/settings.json). */
function configuracaoHooks(slug: string) {
  return JSON.stringify(
    {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: `meraki contexto --projeto ${slug}` }] }],
        PreToolUse: [
          { matcher: "mcp__.*__(apply_migration|execute_sql)", hooks: [{ type: "command", command: `meraki gate --projeto ${slug} --modo autonomo` }] },
          { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: "meraki gate-arquivos --protegido .meraki/" }] },
          // Plano B do gate de publicação: tools do MCP oficial do n8n. O prefixo do servidor muda com o cliente
          // (o nome configurado na CLI, o id do conector no app), por isso o ".*" entre "mcp__" e "__".
          { matcher: "mcp__.*__publish_workflow", hooks: [{ type: "command", command: `meraki gate-publicacao --projeto ${slug}` }] },
        ],
        PostToolUse: [
          {
            matcher: "mcp__.*__(create_workflow_from_code|update_workflow|restore_workflow_version)",
            hooks: [{ type: "command", command: `meraki gate-rascunho --projeto ${slug}` }],
          },
        ],
      },
    },
    null,
    2,
  );
}

/** Variáveis do n8n para o gate de publicação (hooks externos de backend). O token é o mesmo do meraki servir. */
const AMBIENTE_N8N = [
  "EXTERNAL_HOOK_FILES=/caminho/meraki-hooks.cjs",
  "MERAKI_MOTOR_URL=http://meraki-motor:7341",
  "MERAKI_SERVICO_TOKEN=<o mesmo token do meraki servir>",
  "MERAKI_GATE_PRAZO_MS=4000",
  "# só em emergência: publica mesmo com o motor fora do ar",
  "# MERAKI_GATE_EMERGENCIA=1",
].join("\n");

function ConectarN8n() {
  const passos = [
    { cmd: "meraki servir", quando: "rede interna · porta 7341", texto: "o motor responde ao gate, roda as rodadas pedidas e busca conversas ao vivo para a tela" },
    { cmd: "workflow.activate", quando: "hook do n8n · ao publicar", texto: "workflow com agente de IA só vai ao ar se o pacote agente e a rodada de avaliação deixarem" },
    { cmd: "motor fora do ar", quando: "prazo de 4 s", texto: "a publicação é barrada (fecha seguro); MERAKI_GATE_EMERGENCIA=1 libera em emergência" },
    {
      cmd: "chave da API",
      quando: "Vault · fonte n8n",
      texto:
        "workflow:list, workflow:read, execution:list, execution:read, testRun:create, testRun:read e testRun:cancel, com permissão de executar no projeto do workflow. A avaliação roda o rascunho",
    },
  ];
  return (
    <Card>
      <CardHeader
        icon={<Workflow />}
        title="Gate de publicação no n8n"
        description={
          <>
            Carregue <Mono>motor/integracoes/n8n/meraki-hooks.cjs</Mono> no n8n com estas variáveis:
          </>
        }
      />
      <div className="grid gap-5 px-5 pb-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ul className="space-y-3">
          {passos.map((p) => (
            <li key={p.cmd} className="rounded-[7px] border border-line bg-subtle px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Mono className="text-ink">{p.cmd}</Mono>
                <span className="text-[11.5px] text-ink-3">{p.quando}</span>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{p.texto}</p>
            </li>
          ))}
        </ul>
        <Bloco className="max-h-none">{AMBIENTE_N8N}</Bloco>
      </div>
    </Card>
  );
}

function Conectar({ slug }: { slug: string }) {
  const passos = [
    { cmd: "meraki contexto", quando: "SessionStart", texto: "baixa contrato, inventário e achados para .meraki/ e entrega um resumo ao agente" },
    { cmd: "meraki gate", quando: "PreToolUse · apply_migration, execute_sql", texto: "decide em menos de 1 s com o cache local e registra a decisão aqui" },
    { cmd: "meraki gate-arquivos", quando: "PreToolUse · Edit, Write", texto: "o agente não escreve em .meraki/ — só o motor atualiza essa pasta" },
    { cmd: "meraki gate-publicacao", quando: "PreToolUse · publish_workflow", texto: "plano B do gate de publicação: avalia o rascunho ou, com versionId, a versão do histórico que vai ao ar" },
    { cmd: "meraki gate-rascunho", quando: "PostToolUse · criar, editar, restaurar", texto: "o rascunho salvo passa pelo pacote agente e os achados voltam como contexto" },
  ];
  return (
    <Card>
      <CardHeader
        icon={<PlugZap />}
        title="Conectar um agente"
        description={
          <>
            Os hooks do Claude Code chamam o motor no repositório do projeto. Grave em <Mono>.claude/settings.json</Mono>:
          </>
        }
      />
      <div className="grid gap-5 px-5 pb-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ul className="space-y-3">
          {passos.map((p) => (
            <li key={p.cmd} className="rounded-[7px] border border-line bg-subtle px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Mono className="text-ink">{p.cmd}</Mono>
                <span className="text-[11.5px] text-ink-3">{p.quando}</span>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{p.texto}</p>
            </li>
          ))}
        </ul>
        <Bloco className="max-h-none">{configuracaoHooks(slug)}</Bloco>
      </div>
    </Card>
  );
}

/** Parte "Gate": o que cada sessão tentou, o que o gate decidiu e o que os agentes propuseram. */
export function GateView({ slug, d }: { slug: string; d: DadosGate }) {
  const recentes = d.eventos.filter((e) => d.agora - Date.parse(e.criadoEm) < MES);
  const contar = (x: Decisao) => recentes.filter((e) => e.decisao === x).length;
  const propostas = d.propostas.filter((p) => p.origem === "agente");
  const abertas = propostas.filter((p) => p.status === "aberta").length;
  const contrato = projectHref(slug, "contrato");
  // Sem nenhuma atividade de agente, o passo útil é conectar: a configuração sobe para o topo.
  const semAtividade = !d.eventos.length && !propostas.length;

  return (
    <>
      {semAtividade && (
        <div className="mb-9 space-y-4">
          <Conectar slug={slug} />
          <ConectarN8n />
        </div>
      )}
      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard label="Decisões do gate · 30 dias" value={fmtInt(recentes.length)} foot={`${plural(contar("permitiu"), "permitida", "permitidas")} · ${plural(d.sessoes.length, "sessão", "sessões")}`} />
        <StatCard label="Negadas" value={fmtInt(contar("negou"))} status={contar("negou") ? "crit" : "ok"} foot={DECISAO.negou.descricao} />
        <StatCard label="Pediram confirmação" value={fmtInt(contar("perguntou"))} status={contar("perguntou") ? "warn" : undefined} foot={DECISAO.perguntou.descricao} />
        <StatCard
          label="Propostas de agentes abertas"
          value={fmtInt(abertas)}
          status={abertas ? "warn" : undefined}
          foot={
            abertas ? (
              <Link href={contrato} className="inline-flex items-center gap-1 text-ink-2 hover:text-ink">
                Decidir no contrato <ArrowRight className="size-3" />
              </Link>
            ) : (
              `${plural(propostas.length, "proposta", "propostas")} no total`
            )
          }
        />
      </div>

      <Section title="Decisões do gate" description="Cada tentativa de mudar o banco ou publicar um agente, a decisão e o motivo devolvido · clique para expandir">
        <DecisoesGate eventos={d.eventos} agora={d.agora} />
      </Section>

      <Section title="Sessões" description="Agrupadas pela sessão do agente que chamou o gate">
        <Card className="overflow-hidden">
          {d.sessoes.length ? (
            <div className="divide-y divide-line">
              {d.sessoes.map((s) => (
                <div key={`${s.origem}:${s.sessao}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5">
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-line bg-subtle text-ink-2">
                      <Bot className="size-4" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{s.origem}</span>
                      <span className="block truncate text-[11.5px] text-ink-3">
                        sessão <span className="font-mono">{s.sessao}</span> · começou {dataHora(s.inicio)} · última atividade {relativo(s.fim, d.agora)}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2 tnum">
                    {ORDEM.filter((x) => s.decisoes[x]).map((x) => (
                      <span key={x} className="inline-flex items-center gap-1.5">
                        <StatusDot status={DECISAO[x].status} className="size-1.5" />
                        {s.decisoes[x]} {DECISAO[x].label.toLowerCase()}
                      </span>
                    ))}
                    {s.propostas > 0 && <span className="text-ink-3">{plural(s.propostas, "proposta", "propostas")}</span>}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Bot className="size-5" />} title="Nenhuma sessão ainda" description="As sessões aparecem quando um agente com os hooks do Meraki trabalha neste projeto." />
          )}
        </Card>
      </Section>

      <Section
        title="Propostas dos agentes"
        description="Mudanças de estrutura que o agente pediu em vez de aplicar"
        actions={
          <Link href={contrato} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 hover:text-ink">
            Abrir contrato <ArrowRight className="size-3.5" />
          </Link>
        }
      >
        <Card className="overflow-hidden">
          {propostas.length ? (
            <div className="divide-y divide-line">
              {propostas.map((p) => (
                <Link key={p.id} href={contrato} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-subtle">
                  <StatusChip status={STATUS_PROPOSTA[p.status].status} label={STATUS_PROPOSTA[p.status].label} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{p.justificativa}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
                      {TIPO_PROPOSTA[p.tipo] ?? p.tipo}
                      {p.sessao && (
                        <>
                          {" "}
                          · sessão <span className="font-mono">{p.sessao}</span>
                        </>
                      )}
                      {p.objetos.length > 0 && ` · ${plural(p.objetos.length, "objeto", "objetos")}`}
                    </span>
                  </span>
                  {p.contratoVersao !== null && <Pill>contrato v{p.contratoVersao}</Pill>}
                  <span className="text-[12px] text-ink-3 tnum">{relativo(p.decididoEm ?? p.criadoEm, d.agora)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="Nenhuma proposta de agente" description="Quando o gate nega uma estrutura nova, o agente pode propor a mudança com meraki propor." />
          )}
        </Card>
      </Section>

      {!semAtividade && (
        <Section title="Configuração">
          <div className="space-y-4">
            <Conectar slug={slug} />
            <ConectarN8n />
          </div>
        </Section>
      )}
    </>
  );
}

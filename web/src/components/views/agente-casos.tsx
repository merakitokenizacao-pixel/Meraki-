"use client";

import { useMemo, useState, useTransition } from "react";
import { Archive, Check, ChevronRight, FlaskConical, Pencil, Play, Plus, RotateCcw, X } from "lucide-react";
import { useShell } from "@/components/shell/provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Mono, Pill } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, StatusDot } from "@/components/ui/status";
import { arquivarCaso, pedirRodada, salvarCaso } from "@/lib/plataforma/acoes";
import {
  type Caso,
  type Criticidade,
  type DetalheAgente,
  ORIGEM_CASO,
  type OrigemCaso,
  type ResultadoDoCaso,
  type Rodada,
  STATUS_RODADA,
} from "@/lib/plataforma/modelo";
import { dataHora, relativo } from "@/lib/tempo";
import { plural } from "@/lib/url";
import { cn } from "@/lib/utils";

/* ─────────────── Rascunho do formulário ─────────────── */

export type RascunhoDeCaso = {
  /** muda a cada abertura: recria o formulário */
  abertura: number;
  novo: boolean;
  slug: string;
  criticidade: Criticidade;
  origem: OrigemCaso;
  mensagem: string;
  historico: { autor: string; texto: string }[];
  /** datetime-local no fuso de São Paulo (2026-11-16T10:00) */
  dataHora: string;
  /** ficha do contexto: o formulário não edita, mas preserva */
  ficha?: Record<string, unknown>;
  modoTools: "nao_checa" | "nenhuma" | "estas";
  tools: string[];
  argumentos: { tool: string; nome: string; valor: string }[];
  contem: string;
  naoContem: string;
  repasse: "nao_checa" | "sim" | "nao";
  rubrica: string;
  motivo: string;
};

const FUSO = "America/Sao_Paulo";

/** ISO com fuso → valor do input datetime-local no fuso fixo da tela. */
export function paraLocal(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}

/** São Paulo não tem horário de verão desde 2019: −03:00 o ano todo. */
const paraIso = (local: string) => (local ? `${local}:00-03:00` : "");

const lista = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function valorTipado(v: string): string | number | boolean {
  const t = v.trim();
  if (t === "true" || t === "false") return t === "true";
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return v;
}

export function rascunhoVazio(): RascunhoDeCaso {
  return {
    abertura: Date.now(),
    novo: true,
    slug: "",
    criticidade: "normal",
    origem: "manual",
    mensagem: "",
    historico: [],
    dataHora: "",
    modoTools: "nao_checa",
    tools: [],
    argumentos: [],
    contem: "",
    naoContem: "",
    repasse: "nao_checa",
    rubrica: "",
    motivo: "",
  };
}

export function rascunhoDoCaso(c: Caso, motivo = ""): RascunhoDeCaso {
  const e = c.espera ?? {};
  return {
    abertura: Date.now(),
    novo: false,
    slug: c.slug,
    criticidade: c.criticidade,
    origem: c.origem,
    mensagem: c.entrada?.mensagem ?? "",
    historico: c.entrada?.historico ?? [],
    dataHora: paraLocal(c.entrada?.contexto?.data_hora),
    ficha: c.entrada?.contexto?.ficha,
    modoTools: Array.isArray(e.tools) ? (e.tools.length ? "estas" : "nenhuma") : "nao_checa",
    tools: e.tools ?? [],
    argumentos: Object.entries(e.argumentos ?? {}).flatMap(([tool, args]) => Object.entries(args ?? {}).map(([nome, valor]) => ({ tool, nome, valor: String(valor) }))),
    contem: (e.contem ?? []).join(", "),
    naoContem: (e.nao_contem ?? []).join(", "),
    repasse: typeof e.repasse === "boolean" ? (e.repasse ? "sim" : "nao") : "nao_checa",
    rubrica: c.rubrica ?? "",
    motivo,
  };
}

function conteudoDoRascunho(r: RascunhoDeCaso) {
  const espera: Record<string, unknown> = {};
  if (r.modoTools === "nenhuma") espera.tools = [];
  if (r.modoTools === "estas") espera.tools = r.tools;
  const argumentos: Record<string, Record<string, unknown>> = {};
  for (const a of r.argumentos) {
    if (!a.tool || !a.nome.trim()) continue;
    argumentos[a.tool] = { ...argumentos[a.tool], [a.nome.trim()]: valorTipado(a.valor) };
  }
  if (Object.keys(argumentos).length) espera.argumentos = argumentos;
  if (lista(r.contem).length) espera.contem = lista(r.contem);
  if (lista(r.naoContem).length) espera.nao_contem = lista(r.naoContem);
  if (r.repasse !== "nao_checa") espera.repasse = r.repasse === "sim";
  const contexto = { ...(r.dataHora && { data_hora: paraIso(r.dataHora) }), ...(r.ficha && { ficha: r.ficha }) };
  return {
    criticidade: r.criticidade,
    origem: r.origem,
    entrada: {
      mensagem: r.mensagem.trim(),
      ...(Object.keys(contexto).length && { contexto }),
      historico: r.historico.filter((h) => h.texto.trim()),
    },
    espera,
    rubrica: r.rubrica.trim() || null,
  };
}

/* ─────────────── Peças ─────────────── */

const CAMPO = "w-full rounded-[8px] border border-line-2 bg-sunken px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-ink-4 disabled:opacity-60";

function Campo({ rotulo, dica, children, className }: { rotulo: string; dica?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="text-[12px] text-ink-3">{rotulo}</span>
      <div className="mt-1">{children}</div>
      {dica && <span className="mt-1 block text-[11.5px] text-ink-4">{dica}</span>}
    </label>
  );
}

function ChipCriticidade({ c }: { c: Criticidade }) {
  return c === "critico" ? <StatusChip status="crit" label="Crítico" /> : <Pill>normal</Pill>;
}

function Resultado({ r, rotulo }: { r: ResultadoDoCaso | undefined; rotulo: string }) {
  if (!r) return <span className="text-[12px] text-ink-4">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2" title={`${rotulo}: ${r.passou ? "passou" : "falhou"}`}>
      <StatusDot status={r.passou ? "ok" : r.criticidade === "critico" ? "crit" : "serious"} className="size-1.5" />
      {r.passou ? "passou" : "falhou"}
    </span>
  );
}

/* ─────────────── Botão de rodar ─────────────── */

/** Pede uma rodada da versão que o n8n roda (o rascunho). O motor roda os casos ativos no n8n, em ensaio. */
export function BotaoRodar({ projeto, agente, casos, emCurso, agora }: { projeto: string; agente: string; casos: number; emCurso: Rodada | null; agora: number }) {
  const { toast } = useShell();
  const [pendente, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {emCurso && (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3" title={dataHora(emCurso.criadoEm)}>
          <StatusDot status={STATUS_RODADA[emCurso.status].status} pulse={emCurso.status === "rodando"} className="size-1.5" />
          rodada {STATUS_RODADA[emCurso.status].label.toLowerCase()} · {relativo(emCurso.criadoEm, agora)}
        </span>
      )}
      <Button
        variant="primary"
        disabled={pendente || !casos}
        title={casos ? "Roda os casos ativos contra a versão atual do workflow, em ensaio (sem WhatsApp nem agendamento de verdade)" : "Escreva ao menos um caso antes de rodar"}
        onClick={() =>
          start(async () => {
            const r = await pedirRodada(projeto, agente);
            if (r.ok) toast({ title: "Rodada pedida", description: r.mensagem, tone: "ok" });
            else toast({ title: "Não deu para pedir a rodada", description: r.erro, tone: "warn" });
          })
        }
      >
        <Play />
        {pendente ? "Pedindo…" : "Rodar os casos"}
      </Button>
    </div>
  );
}

/* ─────────────── Formulário ─────────────── */

function CasoForm({ d, inicial, onClose }: { d: DetalheAgente; inicial: RascunhoDeCaso; onClose: () => void }) {
  const { toast } = useShell();
  const [r, setR] = useState<RascunhoDeCaso>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();
  const set = <K extends keyof RascunhoDeCaso>(k: K, v: RascunhoDeCaso[K]) => setR((x) => ({ ...x, [k]: v }));
  const nomes = d.ferramentas.filter((t) => !t.desativada).map((t) => t.nome);
  const argumentosDe = (tool: string) => d.ferramentas.find((t) => t.nome === tool)?.argumentos.map((a) => a.nome) ?? [];
  const pronto = r.slug.trim().length >= 2 && r.mensagem.trim().length > 0 && r.motivo.trim().length >= 3 && (r.modoTools !== "estas" || r.tools.length > 0);
  const titulo = !r.novo ? `Editar caso ${r.slug}` : r.origem === "conversa" ? "Caso a partir de uma conversa" : "Novo caso de referência";

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      onSubmit={(ev) => {
        ev.preventDefault();
        setErro(null);
        start(async () => {
          const res = await salvarCaso(d.projeto.id, d.resumo.chave, r.slug.trim(), conteudoDoRascunho(r), r.motivo);
          if (res.ok) {
            toast({ title: "Caso salvo", description: res.mensagem, tone: "ok" });
            onClose();
          } else setErro(res.erro);
        });
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
            <FlaskConical className="size-3.5" />
            {d.resumo.nome} · {ORIGEM_CASO[r.origem]}
          </div>
          <h2 className="mt-1 truncate text-[15px] font-medium text-ink">{titulo}</h2>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Fechar" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 scrollbar-thin">
        <p className="rounded-[7px] border border-line-2 bg-subtle px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2">
          Sem dado pessoal: nome, telefone, e-mail e documento ficam de fora. O banco recusa o caso se encontrar um. Editar cria uma versão nova; as rodadas antigas continuam
          com a versão que usaram.
        </p>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Campo rotulo="Id do caso" dica={r.novo ? "minúsculas, números e hífen (ex.: pedido-de-desconto)" : "o id não muda; para trocar, arquive e crie outro"}>
            <input
              className={cn(CAMPO, "font-mono text-[12.5px]")}
              value={r.slug}
              disabled={!r.novo}
              maxLength={80}
              pattern="[a-z0-9][a-z0-9\-]{1,79}"
              required
              onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              placeholder="nao-agendar-sem-confirmacao"
            />
          </Campo>
          <Campo rotulo="Criticidade">
            <Segmented
              ariaLabel="Criticidade"
              value={r.criticidade}
              onChange={(v) => set("criticidade", v)}
              options={[
                { value: "normal", label: "Normal" },
                { value: "critico", label: "Crítico" },
              ]}
            />
          </Campo>
        </div>
        {r.criticidade === "critico" && <p className="-mt-2 text-[11.5px] text-ink-3">Caso crítico falhando barra a publicação, qualquer que seja a aprovação.</p>}

        <Campo rotulo="Mensagem do cliente">
          <textarea className={cn(CAMPO, "resize-y")} rows={3} required maxLength={4000} value={r.mensagem} onChange={(e) => set("mensagem", e.target.value)} placeholder="tem horário amanhã de manhã?" />
        </Campo>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-ink-3">Conversa antes da mensagem (opcional)</span>
            <Button size="xs" variant="ghost" onClick={() => set("historico", [...r.historico, { autor: "cliente", texto: "" }])} disabled={r.historico.length >= 30}>
              <Plus />
              Fala
            </Button>
          </div>
          {r.historico.length > 0 && (
            <ul className="mt-2 space-y-2">
              {r.historico.map((h, i) => (
                <li key={i} className="flex items-start gap-2">
                  <select
                    className={cn(CAMPO, "w-[112px] shrink-0 px-2")}
                    value={h.autor}
                    onChange={(e) => set("historico", r.historico.map((x, j) => (j === i ? { ...x, autor: e.target.value } : x)))}
                    aria-label="Quem fala"
                  >
                    {["cliente", "agente", "humano"].map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <input
                    className={CAMPO}
                    value={h.texto}
                    maxLength={4000}
                    onChange={(e) => set("historico", r.historico.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))}
                    aria-label="Fala"
                  />
                  <Button size="icon-sm" variant="ghost" aria-label="Remover fala" onClick={() => set("historico", r.historico.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Campo rotulo="Data e hora do caso (opcional)" dica="O agente recebe como contexto: “amanhã de manhã” depende do dia em que a mensagem chega.">
          <input type="datetime-local" className={cn(CAMPO, "w-[240px] [color-scheme:dark]")} value={r.dataHora} onChange={(e) => set("dataHora", e.target.value)} />
        </Campo>

        <div className="space-y-2.5">
          <span className="block text-[12px] text-ink-3">Tools que o agente deve chamar</span>
          <Segmented
            ariaLabel="Tools esperadas"
            size="sm"
            value={r.modoTools}
            onChange={(v) => set("modoTools", v)}
            options={[
              { value: "nao_checa", label: "Não checar" },
              { value: "nenhuma", label: "Nenhuma tool" },
              { value: "estas", label: "Estas, em ordem" },
            ]}
          />
          {r.modoTools === "estas" && (
            <div className="space-y-2">
              <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-[8px] border border-line-2 bg-sunken px-2 py-1.5">
                {r.tools.length ? (
                  r.tools.map((t, i) => (
                    <span key={`${t}:${i}`} className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-line-2 bg-raised pr-1 pl-2 font-mono text-[11.5px] text-ink">
                      <span className="text-ink-3">{i + 1}.</span>
                      {t}
                      <button type="button" aria-label={`Tirar ${t}`} className="grid size-4 place-items-center rounded text-ink-3 hover:text-ink" onClick={() => set("tools", r.tools.filter((_, j) => j !== i))}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="px-1 text-[12px] text-ink-4">clique nas tools abaixo na ordem em que devem ser chamadas</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {nomes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set("tools", [...r.tools, t])}
                    className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-line px-2 font-mono text-[11.5px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
                  >
                    <Plus className="size-3" />
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {r.modoTools === "estas" && r.tools.length > 0 && (
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-ink-3">Argumentos esperados (opcional)</span>
              <Button size="xs" variant="ghost" onClick={() => set("argumentos", [...r.argumentos, { tool: r.tools[0], nome: "", valor: "" }])}>
                <Plus />
                Argumento
              </Button>
            </div>
            {r.argumentos.length > 0 && (
              <ul className="mt-2 space-y-2">
                {r.argumentos.map((a, i) => (
                  <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                    <select
                      className={cn(CAMPO, "px-2 font-mono text-[12px]")}
                      value={a.tool}
                      aria-label="Tool"
                      onChange={(e) => set("argumentos", r.argumentos.map((x, j) => (j === i ? { ...x, tool: e.target.value } : x)))}
                    >
                      {[...new Set(r.tools)].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      className={cn(CAMPO, "font-mono text-[12px]")}
                      list={`args-${i}`}
                      value={a.nome}
                      placeholder="argumento"
                      aria-label="Argumento"
                      onChange={(e) => set("argumentos", r.argumentos.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))}
                    />
                    <datalist id={`args-${i}`}>
                      {argumentosDe(a.tool).map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    <input
                      className={CAMPO}
                      value={a.valor}
                      placeholder="valor"
                      aria-label="Valor esperado"
                      onChange={(e) => set("argumentos", r.argumentos.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))}
                    />
                    <Button size="icon-sm" variant="ghost" aria-label="Remover argumento" onClick={() => set("argumentos", r.argumentos.filter((_, j) => j !== i))}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="A resposta deve conter" dica="separe por vírgula · sem acento e sem diferença de maiúscula">
            <input className={CAMPO} value={r.contem} onChange={(e) => set("contem", e.target.value)} placeholder="confirma, horário" />
          </Campo>
          <Campo rotulo="A resposta não pode conter" dica="palavra inteira · as proibidas do contrato já valem sempre">
            <input className={CAMPO} value={r.naoContem} onChange={(e) => set("naoContem", e.target.value)} placeholder="agendei, agendado" />
          </Campo>
        </div>

        <div className="space-y-2">
          <span className="block text-[12px] text-ink-3">Repasse para a equipe</span>
          <Segmented
            ariaLabel="Repasse"
            size="sm"
            value={r.repasse}
            onChange={(v) => set("repasse", v)}
            options={[
              { value: "nao_checa", label: "Não checar" },
              { value: "sim", label: "Deve repassar" },
              { value: "nao", label: "Não deve repassar" },
            ]}
          />
        </div>

        <Campo rotulo="Rubrica para o juiz (opcional)" dica="O juiz só informa (Correctness e Helpfulness); quem aprova ou reprova são as checagens acima.">
          <textarea className={cn(CAMPO, "resize-y")} rows={2} maxLength={2000} value={r.rubrica} onChange={(e) => set("rubrica", e.target.value)} placeholder="Mostra os horários livres e deixa o cliente escolher, sem agendar." />
        </Campo>

        <Campo rotulo="Motivo desta versão" dica="Fica no histórico do caso.">
          <input className={CAMPO} required minLength={3} maxLength={600} value={r.motivo} onChange={(e) => set("motivo", e.target.value)} placeholder="Ex.: cliente pediu desconto e o agente fechou sem consultar" />
        </Campo>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        {erro && <p className="mr-auto max-w-[60%] text-[12.5px] text-crit-ink">{erro}</p>}
        <Button variant="ghost" disabled={pendente} onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={pendente || !pronto}>
          <Check />
          {pendente ? "Salvando…" : "Salvar caso"}
        </Button>
      </div>
    </form>
  );
}

/** Painel do formulário. Guarda o último rascunho para o conteúdo não sumir enquanto o painel fecha. */
export function CasoSheet({ d, rascunho, onClose }: { d: DetalheAgente; rascunho: RascunhoDeCaso | null; onClose: () => void }) {
  const [mostrado, setMostrado] = useState<RascunhoDeCaso | null>(rascunho);
  if (rascunho && rascunho !== mostrado) setMostrado(rascunho);
  return (
    <Sheet open={rascunho !== null} onClose={onClose} width={640} label="Caso de referência">
      {mostrado && <CasoForm key={mostrado.abertura} d={d} inicial={mostrado} onClose={onClose} />}
    </Sheet>
  );
}

/* ─────────────── Lista ─────────────── */

function Arquivar({ caso, onFim }: { caso: Caso; onFim: () => void }) {
  const { toast } = useShell();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        start(async () => {
          const r = await arquivarCaso(caso.id, motivo);
          if (r.ok) {
            toast({ title: "Caso arquivado", description: r.mensagem, tone: "info" });
            onFim();
          } else setErro(r.erro);
        });
      }}
    >
      <input autoFocus className={cn(CAMPO, "h-8 w-[280px] max-w-full py-1")} required minLength={3} maxLength={600} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que este caso sai das rodadas?" />
      <Button size="sm" type="submit" variant="danger" disabled={pendente || motivo.trim().length < 3}>
        {pendente ? "Arquivando…" : "Arquivar"}
      </Button>
      <Button size="sm" variant="ghost" disabled={pendente} onClick={onFim}>
        Cancelar
      </Button>
      {erro && <span className="w-full text-[12px] text-crit-ink">{erro}</span>}
    </form>
  );
}

function Detalhe({ c, onEditar }: { c: Caso; onEditar: (r: RascunhoDeCaso) => void }) {
  const [arquivando, setArquivando] = useState(false);
  const e = c.espera ?? {};
  const linhas: { rotulo: string; valor: React.ReactNode }[] = [
    {
      rotulo: "Tools, em ordem",
      valor: !Array.isArray(e.tools) ? "não checa" : e.tools.length ? <Mono className="text-[12px]">{e.tools.join(" → ")}</Mono> : "nenhuma tool",
    },
    ...Object.entries(e.argumentos ?? {}).map(([tool, args]) => ({
      rotulo: `Argumentos de ${tool}`,
      valor: (
        <Mono className="text-[12px]">
          {Object.entries(args ?? {})
            .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
            .join(" · ")}
        </Mono>
      ),
    })),
    { rotulo: "Deve conter", valor: e.contem?.length ? e.contem.join(", ") : "—" },
    { rotulo: "Não pode conter", valor: e.nao_contem?.length ? e.nao_contem.join(", ") : "—" },
    { rotulo: "Repasse", valor: typeof e.repasse === "boolean" ? (e.repasse ? "deve repassar" : "não deve repassar") : "não checa" },
  ];
  return (
    <div className="grid gap-5 px-5 pt-1 pb-5 @4xl:grid-cols-2 @4xl:pl-[52px]">
      <div className="min-w-0 space-y-3">
        <div className="text-[11.5px] font-medium text-ink-3">Entrada</div>
        {(c.entrada.historico ?? []).map((h, i) => (
          <p key={i} className="text-[12.5px] leading-relaxed text-ink-3">
            <span className="text-ink-4">{h.autor}:</span> {h.texto}
          </p>
        ))}
        <p className="rounded-[7px] border border-line-2 bg-subtle px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">{c.entrada.mensagem}</p>
        {c.entrada.contexto?.data_hora && <p className="text-[12px] text-ink-3">no contexto: {dataHora(c.entrada.contexto.data_hora)}</p>}
        {c.rubrica && (
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            <span className="text-ink-3">Rubrica do juiz:</span> {c.rubrica}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <div className="text-[11.5px] font-medium text-ink-3">O que se espera</div>
        <dl className="space-y-2">
          {linhas.map((l) => (
            <div key={l.rotulo} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 text-[12.5px]">
              <dt className="text-ink-3">{l.rotulo}</dt>
              <dd className="min-w-0 text-ink-2">{l.valor}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11.5px] text-ink-3">
          Versão <Mono className="text-[11.5px]">{c.hash.slice(0, 8)}</Mono> · {plural(c.versoes, "versão", "versões")}
          {c.autor && ` · ${c.autor}`}
          {c.motivo && ` · “${c.motivo}”`}
        </p>
        {c.ativo ? (
          arquivando ? (
            <Arquivar caso={c} onFim={() => setArquivando(false)} />
          ) : (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onEditar(rascunhoDoCaso(c))}>
                <Pencil />
                Editar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setArquivando(true)}>
                <Archive />
                Arquivar
              </Button>
            </div>
          )
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] text-ink-3">
              Arquivado {c.arquivadoEm ? dataHora(c.arquivadoEm) : ""}
              {c.arquivadoMotivo && ` · ${c.arquivadoMotivo}`}
            </p>
            <Button size="sm" onClick={() => onEditar(rascunhoDoCaso(c, "Reativado"))}>
              <RotateCcw />
              Reativar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

type Filtro = "ativos" | "criticos" | "nunca" | "arquivados";
const COLS = "@4xl:grid-cols-[16px_minmax(0,0.9fr)_88px_minmax(0,1.4fr)_76px_76px_96px]";

/** Casos de referência: o que está coberto e o que nunca rodou. Editar é um formulário, nunca YAML. */
export function CasosDoAgente({ d, onEditar }: { d: DetalheAgente; onEditar: (r: RascunhoDeCaso) => void }) {
  const a = d.resumo;
  const [filtro, setFiltro] = useState<Filtro>("ativos");
  const doNoAr = useMemo(() => new Map(d.resultados.filter((x) => x.rodada === a.rodadaPublicada?.id).map((x) => [x.slug, x])), [d.resultados, a.rodadaPublicada]);
  const doRascunho = useMemo(() => new Map(d.resultados.filter((x) => x.rodada === a.rodadaRascunho?.id).map((x) => [x.slug, x])), [d.resultados, a.rodadaRascunho]);
  const ativos = d.casos.filter((c) => c.ativo);
  const contagem: Record<Filtro, number> = {
    ativos: ativos.length,
    criticos: ativos.filter((c) => c.criticidade === "critico").length,
    nunca: ativos.filter((c) => !c.ultimaRodada).length,
    arquivados: d.casos.filter((c) => !c.ativo).length,
  };
  const visiveis = d.casos.filter((c) =>
    filtro === "arquivados" ? !c.ativo : c.ativo && (filtro === "ativos" || (filtro === "criticos" ? c.criticidade === "critico" : !c.ultimaRodada)),
  );
  const parados = ativos.filter((c) => c.ultimaRodada && d.agora - Date.parse(c.ultimaRodada) > 30 * 86_400_000).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Casos"
          value={filtro}
          onChange={setFiltro}
          options={[
            { value: "ativos", label: "Ativos", count: contagem.ativos },
            { value: "criticos", label: "Críticos", count: contagem.criticos },
            { value: "nunca", label: "Nunca rodaram", count: contagem.nunca },
            { value: "arquivados", label: "Arquivados", count: contagem.arquivados },
          ]}
        />
        <div className="flex items-center gap-3">
          {parados > 0 && <span className="text-[12px] text-ink-3">{plural(parados, "caso sem rodar há mais de 30 dias", "casos sem rodar há mais de 30 dias")}</span>}
          <Button onClick={() => onEditar(rascunhoVazio())}>
            <Plus />
            Novo caso
          </Button>
        </div>
      </div>
      <Card className="overflow-hidden">
        <div className={cn("hidden gap-x-4 border-b border-line bg-sunken px-5 py-2 text-[11.5px] font-medium text-ink-3 @4xl:grid", COLS)}>
          <span />
          <span>Caso</span>
          <span>Criticidade</span>
          <span>Mensagem</span>
          <span>No ar</span>
          <span>{a.rodadaRascunho ? "Rascunho" : ""}</span>
          <span className="text-right">Última rodada</span>
        </div>
        {visiveis.length ? (
          <div className="divide-y divide-line">
            {visiveis.map((c) => (
              <details key={c.id} className="group">
                <summary
                  className={cn(
                    "grid cursor-pointer list-none grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-subtle [&::-webkit-details-marker]:hidden",
                    COLS,
                  )}
                >
                  <ChevronRight className="size-3.5 text-ink-3 transition-transform group-open:rotate-90" />
                  <span className="min-w-0">
                    <Mono className="block truncate text-ink">{c.slug}</Mono>
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{ORIGEM_CASO[c.origem]}</span>
                  </span>
                  <span className="hidden @4xl:block">
                    <ChipCriticidade c={c.criticidade} />
                  </span>
                  <span className="col-span-2 min-w-0 truncate text-[12.5px] text-ink-2 @4xl:col-span-1" title={c.entrada.mensagem}>
                    {c.entrada.mensagem}
                  </span>
                  <span className="hidden @4xl:block">{c.ativo ? <Resultado r={doNoAr.get(c.slug)} rotulo="versão no ar" /> : <span className="text-[12px] text-ink-4">—</span>}</span>
                  <span className="hidden @4xl:block">{a.rodadaRascunho && c.ativo ? <Resultado r={doRascunho.get(c.slug)} rotulo="rascunho" /> : null}</span>
                  <span className="hidden text-right text-[12px] text-ink-3 tnum @4xl:block" title={c.ultimaRodada ? dataHora(c.ultimaRodada) : undefined}>
                    {c.ultimaRodada ? relativo(c.ultimaRodada, d.agora) : "nunca"}
                  </span>
                </summary>
                <Detalhe c={c} onEditar={onEditar} />
              </details>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FlaskConical className="size-5" />}
            title={d.casos.length ? "Nenhum caso com esse filtro" : "Nenhum caso de referência"}
            description={
              d.casos.length
                ? undefined
                : "Escreva os casos que o agente precisa acertar sempre. A rodada roda todos contra cada versão nova, em ensaio, e o gate barra a publicação que piorar."
            }
          />
        )}
      </Card>
    </>
  );
}

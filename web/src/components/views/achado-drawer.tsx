"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUpRight, ShieldCheck, X } from "lucide-react";
import { projectHref } from "@/components/shell/nav";
import { useShell } from "@/components/shell/provider";
import { Button } from "@/components/ui/button";
import { Mono, Pill, ProjectTag } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { SevChip, StatusChip } from "@/components/ui/status";
import { criarExcecao } from "@/lib/plataforma/acoes";
import { type Achado, PACOTE, STATUS_ACHADO, nomeDaChave, partes } from "@/lib/plataforma/modelo";
import { dataHora, diaLongo, diaMais, diasAte } from "@/lib/tempo";
import { setSearchParam, setSearchParams } from "@/lib/url";
import { Bloco, MetaGrid, SectionTitle } from "./comum";

/** Gaveta controlada por `?achado=` — precisa estar dentro de <Suspense>. */
export function AchadoDrawer({ achados, agora }: { achados: Achado[]; agora: number }) {
  const params = useSearchParams();
  const id = params.get("achado");
  const achado = id ? achados.find((a) => a.id === id) : undefined;
  // Mantém o último achado visível durante a animação de saída.
  const [shown, setShown] = useState(achado);
  if (achado && achado !== shown) setShown(achado);

  return (
    <Sheet open={!!achado} onClose={() => setSearchParam("achado", null)} label={shown ? `Achado ${shown.regra}` : "Detalhes do achado"} width={640}>
      {shown && <Detalhe key={shown.id} a={shown} agora={agora} />}
    </Sheet>
  );
}

const temObjeto = (k: string) => ["pg", "n8n", "repo"].includes(partes(k).ns);

function Excecao({ a, agora }: { a: Achado; agora: number }) {
  const { toast } = useShell();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ate, setAte] = useState(() => diaMais(agora, 90));
  const [pendente, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  if (!aberto) {
    return (
      <Button onClick={() => setAberto(true)}>
        <ShieldCheck />
        Abrir exceção
      </Button>
    );
  }
  return (
    <form
      className="w-full space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setErro(null);
        start(async () => {
          const r = await criarExcecao(a.id, motivo, ate);
          if (r.ok) {
            toast({ title: "Exceção registrada", description: r.mensagem, tone: "ok" });
            setAberto(false);
          } else setErro(r.erro);
        });
      }}
    >
      <div className="text-[13px] font-medium text-ink">Abrir exceção para {a.regra}</div>
      <label className="block">
        <span className="text-[12px] text-ink-3">Motivo (fica registrado com o seu nome)</span>
        <textarea
          required
          minLength={3}
          maxLength={600}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          placeholder="Por que esse achado é aceitável por enquanto?"
          className="mt-1 w-full resize-none rounded-[8px] border border-line-2 bg-sunken px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-ink-4"
        />
      </label>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block">
          <span className="text-[12px] text-ink-3">Válida até</span>
          <input
            type="date"
            required
            min={diaMais(agora, 1)}
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            className="mt-1 block h-8 rounded-[8px] border border-line-2 bg-sunken px-2.5 text-[13px] text-ink outline-none focus:border-ink-4"
          />
        </label>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={pendente || motivo.trim().length < 3}>
            {pendente ? "Registrando…" : "Registrar exceção"}
          </Button>
        </div>
      </div>
      {erro && <p className="text-[12.5px] text-crit-ink">{erro}</p>}
    </form>
  );
}

function Detalhe({ a, agora }: { a: Achado; agora: number }) {
  // Na página do próprio projeto o inventário já está carregado: troca de gaveta sem navegar.
  const naPaginaDoProjeto = usePathname() === projectHref(a.projeto.slug);
  const evidencia = a.evidencia && typeof a.evidencia === "object" && Object.keys(a.evidencia).length ? JSON.stringify(a.evidencia, null, 2) : null;
  const linkObjeto = (k: string) =>
    temObjeto(k) && naPaginaDoProjeto ? (
      <button
        type="button"
        onClick={() => setSearchParams({ achado: null, objeto: k })}
        className="inline-flex max-w-full items-center gap-1 font-mono text-[12px] text-ink hover:underline"
        title={k}
      >
        <span className="truncate">{nomeDaChave(k)}</span>
        <ArrowUpRight className="size-3 shrink-0 text-ink-3" />
      </button>
    ) : temObjeto(k) ? (
      <Link
        href={`${projectHref(a.projeto.slug)}?objeto=${encodeURIComponent(k)}`}
        className="inline-flex max-w-full items-center gap-1 font-mono text-[12px] text-ink hover:underline"
        title={k}
      >
        <span className="truncate">{nomeDaChave(k)}</span>
        <ArrowUpRight className="size-3 shrink-0 text-ink-3" />
      </Link>
    ) : (
      <Mono className="text-ink">{k}</Mono>
    );

  const meta = [
    { label: "Regra", value: <span title={a.regraTitulo ?? undefined}>{a.regra}</span> },
    { label: "Pacote", value: a.pacote ? (PACOTE[a.pacote] ?? a.pacote) : "—" },
    { label: "Barra no gate", value: a.bloqueiaNoGate ? "Sim" : "Não" },
    { label: "Origem", value: a.herdado ? "Herdado" : "Novo" },
    { label: "Visto pela 1ª vez", value: dataHora(a.primeiroVisto) },
    { label: "Visto por último", value: dataHora(a.ultimoVisto) },
    { label: "Reaberturas", value: a.reaberturas },
    { label: "Projeto", value: <ProjectTag projeto={a.projeto} className="text-[13px] text-ink" /> },
  ];

  return (
    <>
      <header className="flex items-start gap-3 border-b border-line px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SevChip sev={a.severidade} />
            <Pill className="font-mono">{a.regra}</Pill>
            <StatusChip status={a.status === "aberto" ? "warn" : a.status === "excecao" ? "maint" : "ok"} label={STATUS_ACHADO[a.status]} />
          </div>
          <h2 className="mt-2.5 text-[15px] leading-snug font-medium text-ink">{a.titulo}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{a.regraTitulo}</p>
        </div>
        <button
          type="button"
          aria-label="Fechar painel"
          onClick={() => setSearchParam("achado", null)}
          className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-[8px] text-ink-3 hover:bg-raised hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5 scrollbar-thin">
        {a.detalhe && <p className="text-[13.5px] leading-relaxed text-ink-2">{a.detalhe}</p>}

        <MetaGrid items={meta} />

        <section>
          <SectionTitle>Onde</SectionTitle>
          <dl className="divide-y divide-line rounded-[7px] border border-line">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <dt className="shrink-0 text-ink-3">Objeto</dt>
              <dd className="min-w-0 text-right">{linkObjeto(a.objeto)}</dd>
            </div>
            {a.par && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <dt className="shrink-0 text-ink-3">Relacionado</dt>
                <dd className="min-w-0 text-right">{linkObjeto(a.par)}</dd>
              </div>
            )}
          </dl>
        </section>

        {a.regraDescricao && (
          <section>
            <SectionTitle>Sobre a regra</SectionTitle>
            <p className="rounded-[7px] border border-line-2 bg-subtle p-4 text-[13px] leading-relaxed text-ink-2">{a.regraDescricao}</p>
          </section>
        )}

        {a.excecao && (
          <section>
            <SectionTitle aside={<span className="text-[12px] text-ink-3">{a.excecao.origem === "contrato" ? "declarada no contrato" : "aberta na tela"}</span>}>
              Exceção
            </SectionTitle>
            <div className="rounded-[7px] border border-line-2 bg-subtle p-4">
              <p className="text-[13px] leading-relaxed text-ink-2">{a.excecao.motivo}</p>
              <p className="mt-2 text-[12px] text-ink-3">
                Válida até {diaLongo(a.excecao.ate)}
                {diasAte(a.excecao.ate, agora) >= 0 ? ` (${diasAte(a.excecao.ate, agora)} dias)` : " · vencida"}
                {a.excecao.autor && ` · ${a.excecao.autor}`}
              </p>
            </div>
          </section>
        )}

        <section>
          <SectionTitle aside={<span className="text-[12px] text-ink-3">coleta, objeto, node, linha ou consulta</span>}>Evidência</SectionTitle>
          {evidencia ? <Bloco>{evidencia}</Bloco> : <p className="text-[13px] text-ink-3">Sem evidência registrada.</p>}
        </section>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-line px-6 py-3">
        {a.status === "aberto" ? (
          <Excecao a={a} agora={agora} />
        ) : (
          <span className="text-[12.5px] text-ink-3">
            {a.status === "excecao" ? "Em exceção: não conta na saúde enquanto valer." : `Resolvido ${a.resolvidoEm ? dataHora(a.resolvidoEm) : ""}`}
          </span>
        )}
      </footer>
    </>
  );
}

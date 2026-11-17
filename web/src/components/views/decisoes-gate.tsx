"use client";

import { useState } from "react";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, Mono, Pill } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { DecisaoChip } from "@/components/ui/status";
import { type Decisao, type EventoGate } from "@/lib/plataforma/modelo";
import { dataHora, relativo } from "@/lib/tempo";
import { fmtMs } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filtro = "todas" | Decisao;

const COLS = "@4xl:grid-cols-[16px_96px_minmax(0,1fr)_150px_96px]";

/** O que os agentes tentaram e o que o gate decidiu — o motivo é o mesmo texto que o agente recebeu. */
export function DecisoesGate({ eventos, agora }: { eventos: EventoGate[]; agora: number }) {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const visiveis = filtro === "todas" ? eventos : eventos.filter((e) => e.decisao === filtro);
  const contar = (d: Decisao) => eventos.filter((e) => e.decisao === d).length;

  return (
    <>
      {eventos.length > 0 && (
        <Segmented
          ariaLabel="Decisão"
          className="mb-3"
          value={filtro}
          onChange={setFiltro}
          options={[
            { value: "todas", label: "Todas", count: eventos.length },
            { value: "negou", label: "Negou", count: contar("negou") },
            { value: "perguntou", label: "Perguntou", count: contar("perguntou") },
            { value: "permitiu", label: "Permitiu", count: contar("permitiu") },
          ]}
        />
      )}
      <Card className="overflow-hidden">
        <div className={cn("hidden gap-x-4 border-b border-line bg-sunken px-5 py-2 text-[11.5px] font-medium text-ink-3 @4xl:grid", COLS)}>
          <span />
          <span>Decisão</span>
          <span>O que o agente tentou</span>
          <span>Ferramenta</span>
          <span className="text-right">Quando</span>
        </div>
        {visiveis.length ? (
          <div className="divide-y divide-line">
            {visiveis.map((ev) => (
              <details key={ev.id} className="group">
                <summary
                  className={cn(
                    "grid cursor-pointer list-none grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-subtle [&::-webkit-details-marker]:hidden",
                    COLS,
                  )}
                >
                  <ChevronRight className="size-3.5 text-ink-3 transition-transform group-open:rotate-90" />
                  <span className="hidden @4xl:block">
                    <DecisaoChip decisao={ev.decisao} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[12px] text-ink" title={ev.resumo}>
                      {ev.resumo}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
                      <span className="@4xl:hidden">
                        <DecisaoChip decisao={ev.decisao} />
                      </span>
                      {ev.regras.length ? (
                        ev.regras.map((r) => (
                          <Pill key={r} className="h-[18px] px-1.5 font-mono text-[10.5px]">
                            {r}
                          </Pill>
                        ))
                      ) : (
                        <span>nenhuma regra violada</span>
                      )}
                    </span>
                  </span>
                  <Mono className="hidden truncate text-[11.5px] text-ink-3 @4xl:block" title={ev.ferramenta}>
                    {ev.ferramenta.split("__").pop()}
                  </Mono>
                  <span className="text-right text-[12px] text-ink-3 tnum" title={dataHora(ev.criadoEm)}>
                    {relativo(ev.criadoEm, agora)}
                  </span>
                </summary>
                <div className="space-y-3 px-5 pt-1 pb-4 @4xl:pl-[52px]">
                  {ev.motivo ? (
                    <p className="rounded-[7px] border border-line-2 bg-subtle p-3.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{ev.motivo}</p>
                  ) : (
                    <p className="text-[12.5px] text-ink-3">A mudança não introduz violação: o gate liberou sem mensagem.</p>
                  )}
                  <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                    {[
                      { label: "Origem", value: ev.origem },
                      { label: "Sessão", value: ev.sessao ?? "—" },
                      { label: "Modo", value: ev.modo === "autonomo" ? "autônomo" : ev.modo === "pergunta" ? "pergunta" : "—" },
                      { label: "Tempo de decisão", value: ev.duracaoMs === null ? "—" : ev.duracaoMs < 1 ? "< 1 ms" : fmtMs(ev.duracaoMs) },
                      { label: "Ferramenta", value: ev.ferramenta },
                    ].map((m) => (
                      <div key={m.label} className="flex gap-1.5">
                        <dt className="text-ink-3">{m.label}</dt>
                        <dd className="font-mono text-[11.5px] text-ink-2">{m.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ShieldCheck className="size-5" />}
            title={eventos.length ? "Nenhuma decisão com esse filtro" : "Nenhuma decisão registrada"}
            description={eventos.length ? undefined : "Quando um agente tentar mudar o banco, a decisão do gate aparece aqui com o motivo."}
          />
        )}
      </Card>
    </>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { FlaskConical, Lock, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { buscarConversa } from "@/lib/plataforma/acoes";
import { type ConversaAoVivo, type DetalheAgente, versaoCurta } from "@/lib/plataforma/modelo";
import { dataHora } from "@/lib/tempo";
import { plural } from "@/lib/url";
import { cn } from "@/lib/utils";
import { type RascunhoDeCaso, paraLocal, rascunhoVazio } from "./agente-casos";

const AUTOR: Record<string, string> = { agente: "Agente", cliente: "Cliente", humano: "Equipe" };

/**
 * Caso a partir da conversa: a mensagem do cliente que levou à resposta em destaque vira a entrada, e o que veio
 * antes vira o histórico. O texto já chega anonimizado pelo motor; salvar_caso ainda recusa dado pessoal.
 */
function rascunhoDaConversa(c: ConversaAoVivo, mensagem: string): RascunhoDeCaso {
  const ms = c.mensagens;
  let i = ms.findIndex((m) => m.destaque);
  if (i < 0) i = ms.length - 1;
  let j = i;
  while (j >= 0 && (ms[j].autor === "agente" || ms[j].autor === "humano")) j--;
  if (j < 0) j = i;
  const entrada = ms[j];
  const slug = `conversa-${entrada.momento.slice(0, 10)}-${mensagem.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)}`.replace(/-+$/, "");
  return {
    ...rascunhoVazio(),
    origem: "conversa",
    slug,
    mensagem: entrada.texto,
    historico: ms.slice(Math.max(0, j - 10), j).map((m) => ({ autor: AUTOR[m.autor] ? m.autor : "cliente", texto: m.texto })),
    dataHora: paraLocal(entrada.momento),
    motivo: "Conversa real revisada na tela: resposta fora da política",
  };
}

function Mensagem({ m }: { m: ConversaAoVivo["mensagens"][number] }) {
  const doAgente = m.autor === "agente";
  return (
    <li className={cn("flex", doAgente ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[86%] min-w-0", doAgente && "text-right")}>
        <div className="mb-1 text-[11px] text-ink-3">
          {AUTOR[m.autor] ?? m.autor} · {dataHora(m.momento)}
          {m.destaque && <span className="ml-1.5 font-medium text-warn-ink">· mensagem revisada</span>}
        </div>
        <p
          className={cn(
            "rounded-card border px-3.5 py-2.5 text-left text-[13px] leading-relaxed whitespace-pre-wrap break-words",
            doAgente ? "border-line-2 bg-raised text-ink" : m.autor === "humano" ? "border-dashed border-line-2 bg-surface text-ink-2" : "border-line bg-subtle text-ink-2",
            m.destaque && "border-warn/60 ring-1 ring-warn/30",
          )}
        >
          {m.texto || <span className="text-ink-4">(sem texto)</span>}
        </p>
      </div>
    </li>
  );
}

/** Conversa: o que aconteceu nesta conversa, sem gravar nada. Ao fechar, o texto sai da tela. */
export function ConversaSheet({
  d,
  mensagem,
  onClose,
  onVirarCaso,
}: {
  d: DetalheAgente;
  mensagem: string | null;
  onClose: () => void;
  onVirarCaso: (r: RascunhoDeCaso) => void;
}) {
  const [estado, setEstado] = useState<{ id: string; conversa?: ConversaAoVivo; erro?: string } | null>(null);
  const [pendente, start] = useTransition();
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!mensagem) return;
    let vivo = true;
    start(async () => {
      const r = await buscarConversa(d.projeto.slug, d.resumo.chave, mensagem);
      if (vivo) setEstado(r.ok ? { id: mensagem, conversa: r.conversa } : { id: mensagem, erro: r.erro });
    });
    return () => {
      vivo = false;
    };
  }, [mensagem, d.projeto.slug, d.resumo.chave, tentativa]);

  const atual = estado && estado.id === mensagem ? estado : null;
  const c = atual?.conversa;
  const fechar = () => {
    setEstado(null);
    onClose();
  };

  return (
    <Sheet open={Boolean(mensagem)} onClose={fechar} width={620} label="Conversa ao vivo">
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="text-[11.5px] text-ink-3">{d.resumo.nome} · conversa ao vivo</div>
          <h2 className="mt-1 text-[15px] font-medium text-ink">Revisar conversa</h2>
          {c && (
            <p className="mt-1 text-[12px] text-ink-3">
              versão no ar na hora: <Mono className="text-[11.5px]">v{versaoCurta(c.versao)}</Mono>
              {c.incerta && " (incerta: entre a publicação e a coleta)"} · {plural(c.mensagens.length, "mensagem", "mensagens")}
              {c.anonimizados > 0 && ` · ${plural(c.anonimizados, "trecho anonimizado", "trechos anonimizados")}`}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Fechar" onClick={fechar}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 scrollbar-thin">
        <p className="mb-5 flex gap-2.5 rounded-[7px] border border-line-2 bg-subtle px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
          Buscada agora no banco do projeto e anonimizada pelo motor. Nada desta conversa é gravado na plataforma; ao fechar, ela sai da tela.
        </p>
        {c ? (
          <ul className="space-y-4">
            {c.mensagens.map((m) => (
              <Mensagem key={m.id} m={m} />
            ))}
          </ul>
        ) : atual?.erro ? (
          <div className="space-y-3 rounded-[7px] border border-crit/30 bg-crit-soft px-4 py-3">
            <p className="text-[12.5px] text-crit-ink">{atual.erro}</p>
            <Button size="sm" disabled={pendente} onClick={() => setTentativa((n) => n + 1)}>
              <RotateCw />
              Tentar de novo
            </Button>
          </div>
        ) : (
          <div className="space-y-4" aria-busy="true" aria-label="Buscando a conversa">
            {["w-[62%]", "w-[48%]", "w-[70%]", "w-[40%]"].map((w, i) => (
              <div key={w} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
                <Skeleton className={cn("h-12", w)} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <span className="text-[11.5px] text-ink-3">Virar caso leva a mensagem para um caso de referência (anonimizado).</span>
        <Button variant="primary" disabled={!c || !mensagem} onClick={() => c && mensagem && onVirarCaso(rascunhoDaConversa(c, mensagem))}>
          <FlaskConical />
          Virar caso
        </Button>
      </div>
    </Sheet>
  );
}

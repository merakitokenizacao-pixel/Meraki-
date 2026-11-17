"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Check, RotateCcw, Sparkles, X } from "lucide-react";
import { StatusDot } from "@/components/ui/status";
import { cn } from "@/lib/utils";
import { DEFAULT_SUGGESTIONS, GREETING, answerFor, type Answer, type Block } from "./copilot-answers";
import { useShell } from "./provider";

type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; answer: Answer; phase: "thinking" | "writing" | "done"; step: number; block: number; words: number };

const greeting = (): Msg[] => [{ id: 1, role: "assistant", answer: GREETING, phase: "done", step: 0, block: GREETING.blocks.length, words: 0 }];

const RANGE_WORDS: Record<string, string> = { "1h": "1 hora", "24h": "24 horas", "7d": "7 dias", "30d": "30 dias" };

/** Negrito simples com **marcação**. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((p, i) =>
        i % 2 ? (
          <strong key={i} className="font-medium text-ink">
            {p}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const wordsOf = (b: Block) => (b.t === "text" ? b.text.split(" ").length : 0);

function BlockView({ b, words, onAction }: { b: Block; words?: number; onAction: (toast: string) => void }) {
  switch (b.t) {
    case "text": {
      const shown = words === undefined ? b.text : b.text.split(" ").slice(0, words).join(" ");
      return (
        <p className="text-[13.5px] leading-[1.65] text-ink-2">
          <Rich text={shown} />
          {words !== undefined && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-ink-2" />}
        </p>
      );
    }
    case "bullets":
      return (
        <ul className="animate-fade space-y-1.5">
          {b.items.map((it, i) => (
            <li key={i} className="flex gap-2.5 text-[13.5px] leading-[1.6] text-ink-2">
              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-3" />
              <span>
                <Rich text={it} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "evidence":
      return (
        <div className="animate-fade overflow-hidden rounded-[10px] border border-line-2 bg-subtle">
          {b.items.map((e) => (
            <div key={e.label} className="flex items-center gap-2.5 border-b border-line-2 px-3 py-2 text-[12.5px] last:border-0">
              <StatusDot status={e.status} />
              <span className="flex-1 text-ink-2">{e.label}</span>
              <span className="font-medium text-ink tnum">{e.value}</span>
            </div>
          ))}
        </div>
      );
    case "results":
      return (
        <div className="animate-fade overflow-hidden rounded-[10px] border border-line-2 bg-subtle">
          {b.items.map((r) => (
            <Link
              key={r.label + r.sub}
              href={r.href}
              className="group flex items-center gap-2.5 border-b border-line-2 px-3 py-2 transition-colors last:border-0 hover:bg-raised"
            >
              {r.status ? <StatusDot status={r.status} /> : <span className="size-2 shrink-0 rounded-full" style={{ background: r.marker }} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{r.label}</span>
                <span className="block truncate text-[11.5px] text-ink-3">{r.sub}</span>
              </span>
              <span className="shrink-0 text-[12.5px] font-medium text-ink tnum">{r.value}</span>
              <ArrowUpRight className="size-3.5 shrink-0 text-ink-4 transition-colors group-hover:text-ink" />
            </Link>
          ))}
        </div>
      );
    case "actions":
      return (
        <div className="flex animate-fade flex-wrap gap-2">
          {b.items.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => onAction(a.toast)}
              className={cn(
                "inline-flex h-8 items-center rounded-[8px] px-3 text-[12.5px] font-medium transition-colors",
                a.primary ? "bg-ink text-on-ink hover:bg-white" : "border border-line-2 bg-raised text-ink hover:bg-muted",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      );
    case "links":
      return (
        <div className="flex animate-fade flex-wrap gap-1.5">
          {b.items.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-line-2 px-2.5 text-[12px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
            >
              {l.label}
              <ArrowUpRight className="size-3" />
            </Link>
          ))}
        </div>
      );
  }
}

function AssistantMark({ busy }: { busy?: boolean }) {
  return (
    <span className="relative grid size-7 shrink-0 place-items-center rounded-[8px] border border-accent/30 bg-accent-soft text-accent-ink">
      <Sparkles className={cn("size-3.5", busy && "animate-breathe")} />
    </span>
  );
}

export function Copilot() {
  const { copilotOpen, closeCopilot, copilotAsk, toast, env, range } = useShell();
  const [msgs, setMsgs] = useState<Msg[]>(greeting);
  const [input, setInput] = useState("");
  const [handled, setHandled] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const last = msgs[msgs.length - 1];
  const busy = last.role === "assistant" && last.phase !== "done";

  const send = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setMsgs((ms) => {
      const id = ms[ms.length - 1].id + 1;
      return [
        ...ms,
        { id, role: "user", text: q },
        { id: id + 1, role: "assistant", answer: answerFor(q), phase: "thinking", step: 0, block: 0, words: 0 },
      ];
    });
    setInput("");
  };

  // Perguntas vindas de outras telas (botões “Perguntar ao Copilot”, paleta Ctrl K).
  if (copilotAsk && copilotAsk.nonce !== handled) {
    setHandled(copilotAsk.nonce);
    send(copilotAsk.text);
  }

  // Animação: etapas de análise → escrita palavra a palavra → blocos.
  useEffect(() => {
    if (last.role !== "assistant" || last.phase === "done") return;
    const current = last.answer.blocks[last.block];
    const delay = last.phase === "thinking" ? 460 : current && current.t !== "text" ? 170 : 26;
    const timer = window.setTimeout(() => {
      setMsgs((ms) =>
        ms.map((m) => {
          if (m.id !== last.id || m.role !== "assistant") return m;
          if (m.phase === "thinking") return m.step < m.answer.steps.length ? { ...m, step: m.step + 1 } : { ...m, phase: "writing" };
          const b = m.answer.blocks[m.block];
          if (!b) return { ...m, phase: "done" };
          if (b.t === "text" && m.words < wordsOf(b)) return { ...m, words: m.words + 3 };
          const next = m.block + 1;
          return next >= m.answer.blocks.length ? { ...m, block: next, words: 0, phase: "done" } : { ...m, block: next, words: 0 };
        }),
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [last]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  useEffect(() => {
    if (!copilotOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeCopilot();
    window.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => inputRef.current?.focus(), 250);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [copilotOpen, closeCopilot]);

  const onAction = (msg: string) => {
    if (msg === "Resumo copiado")
      navigator.clipboard?.writeText("Resumo Meraki — últimas 24 h: saúde 84 (−5). SEV-1 Postgres do Atlas; SEV-2 Aurora e checkout da Vega.").catch(() => {});
    toast({ title: msg, description: "Ação simulada — nada foi alterado nos sistemas.", tone: "ok" });
  };

  const suggestions = last.role === "assistant" && last.phase === "done" ? (last.answer.suggestions ?? DEFAULT_SUGGESTIONS) : [];

  return (
    <aside
      role="complementary"
      aria-label="Meraki Copilot"
      aria-hidden={!copilotOpen}
      inert={!copilotOpen}
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex w-[min(420px,100vw)] flex-col border-l border-line-2 bg-surface shadow-pop transition-transform duration-300 ease-[cubic-bezier(.2,.7,.2,1)]",
        copilotOpen ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <AssistantMark />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-ink">Copilot</div>
          <div className="truncate text-[11.5px] text-ink-3">
            {env === "prod" ? "Produção" : env === "staging" ? "Staging" : "Todos os ambientes"} · {RANGE_WORDS[range]} · 41 fontes
          </div>
        </div>
        <button
          type="button"
          aria-label="Nova conversa"
          title="Nova conversa"
          onClick={() => setMsgs(greeting())}
          className="grid size-7 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-raised hover:text-ink"
        >
          <RotateCcw className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Fechar Copilot"
          onClick={closeCopilot}
          className="grid size-7 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-raised hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 scrollbar-thin">
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex animate-fade justify-end">
              <div className="max-w-[85%] rounded-[12px] border border-line-2 bg-raised px-3.5 py-2 text-[13.5px] leading-relaxed text-ink">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-3">
              <AssistantMark busy={m.phase !== "done"} />
              <div className="min-w-0 flex-1 space-y-3 pt-0.5">
                {m.answer.steps.length > 0 && (
                  <ul className="space-y-1">
                    {m.answer.steps.map((s, i) => {
                      const done = i < m.step || m.phase !== "thinking";
                      const current = m.phase === "thinking" && i === m.step;
                      if (!done && !current) return null;
                      return (
                        <li key={i} className="flex animate-fade items-center gap-2 text-[12px]">
                          {done ? (
                            <Check className="size-3.5 text-ok-ink" strokeWidth={2.5} />
                          ) : (
                            <span className="grid size-3.5 place-items-center">
                              <span className="size-1.5 animate-ping rounded-full bg-accent" />
                            </span>
                          )}
                          <span className={done ? "text-ink-3" : "shimmer-text animate-shimmer"}>{s}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {m.phase !== "thinking" &&
                  m.answer.blocks.map((b, i) => {
                    if (m.phase === "done" || i < m.block) return <BlockView key={i} b={b} onAction={onAction} />;
                    if (i === m.block && b.t === "text") return <BlockView key={i} b={b} words={m.words} onAction={onAction} />;
                    return null;
                  })}
              </div>
            </div>
          ),
        )}
        {suggestions.length > 0 && (
          <div className="flex animate-fade flex-wrap gap-1.5 pl-10">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-line-2 px-3 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        className="shrink-0 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) send(input);
        }}
      >
        <div className="flex items-center gap-2 rounded-[10px] border border-line-2 bg-sunken py-1.5 pr-1.5 pl-3.5 transition-colors focus-within:border-ink-4">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte sobre sistemas, agentes ou custos…"
            className="h-8 flex-1 bg-transparent text-[13.5px] text-ink outline-none"
            aria-label="Mensagem para o Copilot"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Enviar"
            className="grid size-8 place-items-center rounded-[8px] bg-ink text-on-ink transition-opacity disabled:opacity-20"
          >
            <ArrowUp className="size-4" strokeWidth={2.25} />
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] text-ink-3">Respostas geradas a partir das métricas do workspace. Ações simuladas neste protótipo.</p>
      </form>
    </aside>
  );
}

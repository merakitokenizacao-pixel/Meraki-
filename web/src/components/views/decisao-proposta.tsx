"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { useShell } from "@/components/shell/provider";
import { Button } from "@/components/ui/button";
import { aprovarProposta, recusarProposta } from "@/lib/plataforma/acoes";

/** Aprovar publica uma nova versão do contrato; recusar exige motivo (o gate devolve esse texto ao agente). */
export function DecisaoProposta({ id, origem }: { id: string; origem: "agente" | "voce" }) {
  const { toast } = useShell();
  const [modo, setModo] = useState<"aprovar" | "recusar" | null>(null);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();

  if (!modo) {
    return (
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-ink-3">Aprovar publica uma nova versão do contrato e o gate passa a aceitar a mudança.</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setModo("recusar")}>
            <X />
            Recusar
          </Button>
          <Button variant="primary" onClick={() => setModo("aprovar")}>
            <Check />
            Aprovar
          </Button>
        </div>
      </div>
    );
  }

  const recusar = modo === "recusar";
  return (
    <form
      className="w-full space-y-3 py-1"
      onSubmit={(ev) => {
        ev.preventDefault();
        setErro(null);
        start(async () => {
          const r = recusar ? await recusarProposta(id, texto) : await aprovarProposta(id, texto);
          if (r.ok) toast({ title: recusar ? "Proposta recusada" : "Proposta aprovada", description: r.mensagem, tone: recusar ? "info" : "ok" });
          else setErro(r.erro);
        });
      }}
    >
      <label className="block">
        <span className="text-[12px] text-ink-3">
          {recusar
            ? origem === "agente"
              ? "Motivo da recusa — o agente recebe este texto se tentar de novo"
              : "Motivo da recusa — fica no histórico do contrato"
            : "Nota da aprovação (opcional) — fica no histórico do contrato"}
        </span>
        <textarea
          autoFocus
          required={recusar}
          minLength={recusar ? 3 : undefined}
          maxLength={600}
          rows={3}
          value={texto}
          onChange={(ev) => setTexto(ev.target.value)}
          placeholder={recusar ? "Por que essa mudança não deve entrar agora?" : "Ex.: combinado com o time de produto"}
          className="mt-1 w-full resize-none rounded-[8px] border border-line-2 bg-sunken px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-ink-4"
        />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {erro && <p className="mr-auto text-[12.5px] text-crit-ink">{erro}</p>}
        <Button
          variant="ghost"
          disabled={pendente}
          onClick={() => {
            setModo(null);
            setErro(null);
          }}
        >
          Cancelar
        </Button>
        <Button type="submit" variant={recusar ? "danger" : "primary"} disabled={pendente || (recusar && texto.trim().length < 3)}>
          {pendente ? "Registrando…" : recusar ? "Recusar proposta" : "Aprovar e publicar"}
        </Button>
      </div>
    </form>
  );
}

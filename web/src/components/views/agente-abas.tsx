"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import type { DetalheAgente } from "@/lib/plataforma/modelo";
import { setSearchParam } from "@/lib/url";
import { CasoSheet, CasosDoAgente, type RascunhoDeCaso } from "./agente-casos";
import { ConversaSheet } from "./agente-conversa";
import { EstruturaDoAgente } from "./agente-estrutura";
import { ProducaoDoAgente } from "./agente-producao";
import { RodadasDoAgente } from "./agente-rodadas";

type Aba = "estrutura" | "casos" | "rodadas" | "producao";
const ABAS: Aba[] = ["estrutura", "casos", "rodadas", "producao"];

/** Abas do agente na URL (?aba=), a conversa ao vivo (?conversa=) e o formulário de caso, que as duas abrem. */
export function AbasDoAgente({ d }: { d: DetalheAgente }) {
  const params = useSearchParams();
  const pedida = params.get("aba") as Aba | null;
  const aba: Aba = pedida && ABAS.includes(pedida) ? pedida : "estrutura";
  const conversa = params.get("conversa");
  const [form, setForm] = useState<RascunhoDeCaso | null>(null);
  const abertos = d.achados.filter((x) => x.status === "aberto").length;

  return (
    <div className="mt-9">
      <Segmented
        ariaLabel="Partes do agente"
        value={aba}
        onChange={(v) => setSearchParam("aba", v === "estrutura" ? null : v, "replace")}
        options={[
          { value: "estrutura", label: "Estrutura", count: abertos || undefined },
          { value: "casos", label: "Casos", count: d.resumo.casos.ativos },
          { value: "rodadas", label: "Rodadas", count: d.rodadas.length },
          { value: "producao", label: "Produção" },
        ]}
      />
      <div className="mt-6">
        {aba === "estrutura" && <EstruturaDoAgente d={d} />}
        {aba === "casos" && <CasosDoAgente d={d} onEditar={setForm} />}
        {aba === "rodadas" && <RodadasDoAgente d={d} />}
        {aba === "producao" && <ProducaoDoAgente d={d} />}
      </div>
      <CasoSheet d={d} rascunho={form} onClose={() => setForm(null)} />
      <ConversaSheet
        d={d}
        mensagem={conversa}
        onClose={() => setSearchParam("conversa", null)}
        onVirarCaso={(r) => {
          setSearchParam("conversa", null);
          setForm(r);
        }}
      />
    </div>
  );
}

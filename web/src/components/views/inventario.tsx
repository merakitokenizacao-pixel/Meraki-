"use client";

import { Suspense, useMemo, useState } from "react";
import { Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { FonteIcon, ObjetoIcon } from "@/components/ui/objeto-icon";
import { MultiSelectChip } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { StatusDot } from "@/components/ui/status";
import { estadoDosAchados } from "@/lib/plataforma/fluxo";
import { type EstruturaProjeto, type Objeto, TIPO_OBJETO, TIPOS_FILHOS, declaracaoDe, ordemSev } from "@/lib/plataforma/modelo";
import { declaravel, descreverDeclaracao, indexar } from "@/lib/plataforma/objetos";
import { relativo } from "@/lib/tempo";
import { fmtCompact } from "@/lib/format";
import { setSearchParam } from "@/lib/url";
import { cn, normalize } from "@/lib/utils";
import { ObjetoDrawer } from "./objeto-drawer";

const ORDEM_TIPO = ["tabela", "visao", "funcao", "workflow", "credencial", "arquivo", "rota", "env", "papel", "bucket", "extensao", "migracao"];

const TIPO_PLURAL: Record<string, string> = {
  tabela: "Tabelas",
  visao: "Visões",
  funcao: "Funções",
  workflow: "Workflows",
  credencial: "Credenciais",
  arquivo: "Arquivos",
  rota: "Rotas de API",
  env: "Variáveis de ambiente",
  papel: "Papéis do banco",
  bucket: "Buckets",
  extensao: "Extensões",
  migracao: "Migrations",
};

const ordemTipo = (t: string) => (ORDEM_TIPO.includes(t) ? ORDEM_TIPO.indexOf(t) : ORDEM_TIPO.length);

const SEMANA = 7 * 86_400_000;

type Situacao = "achado" | "fora" | "alterado" | "sem_uso";

const COLS = "@4xl:grid-cols-[minmax(0,1fr)_128px_168px_72px_112px]";

function Uso({ o }: { o: Objeto }) {
  const u = o.uso;
  if (!u) return <span className="text-[12.5px] text-ink-4">—</span>;
  if (o.tipo === "funcao") return <span className="text-[12.5px] text-ink-2 tnum">{fmtCompact(u.leituras + u.escritas)} chamadas</span>;
  return (
    <span className="block min-w-0">
      <span className="block truncate text-[12.5px] text-ink-2 tnum">{u.vazia ? "vazia" : u.linhas !== null ? `${fmtCompact(u.linhas)} ${u.linhas === 1 ? "linha" : "linhas"}` : "—"}</span>
      <span className="block truncate text-[11.5px] text-ink-3 tnum">
        {u.leituras + u.escritas ? `${fmtCompact(u.leituras)} leituras · ${fmtCompact(u.escritas)} escritas` : "sem uso na semana"}
      </span>
    </span>
  );
}

function Tabela({ e }: { e: EstruturaProjeto }) {
  const idx = useMemo(() => indexar(e), [e]);
  const [fonte, setFonte] = useState("todas");
  const [q, setQ] = useState("");
  const [tipos, setTipos] = useState<string[]>([]);
  const [situacoes, setSituacoes] = useState<string[]>([]);

  const topo = useMemo(() => e.objetos.filter((o) => !TIPOS_FILHOS.has(o.tipo)), [e.objetos]);
  const fontes = useMemo(() => [...new Map(topo.map((o) => [o.fonte.id, o.fonte])).values()], [topo]);
  const daFonte = useMemo(() => (fonte === "todas" ? topo : topo.filter((o) => o.fonte.id === fonte)), [topo, fonte]);

  const situacao = useMemo(() => {
    const tem = (o: Objeto, s: Situacao) => {
      if (s === "achado") return Boolean(idx.achados.get(o.chave)?.length);
      if (s === "fora") return e.contratoVersao !== null && declaravel(o) && !declaracaoDe(e.declarados, o);
      if (s === "alterado") return Boolean(o.alteradoEm && e.agora - Date.parse(o.alteradoEm) < SEMANA);
      return Boolean(o.uso && o.uso.leituras + o.uso.escritas === 0);
    };
    return tem;
  }, [idx, e.contratoVersao, e.declarados, e.agora]);

  const visiveis = useMemo(() => {
    const termo = normalize(q.trim());
    return daFonte.filter(
      (o) =>
        (!tipos.length || tipos.includes(o.tipo)) &&
        (!situacoes.length || situacoes.some((s) => situacao(o, s as Situacao))) &&
        (!termo || normalize(`${o.nome} ${o.chave} ${descreverDeclaracao(declaracaoDe(e.declarados, o)) ?? ""}`).includes(termo)),
    );
  }, [daFonte, tipos, situacoes, situacao, q, e.declarados]);

  const grupos = useMemo(() => {
    const peso = (o: Objeto) => {
      const lista = idx.achados.get(o.chave);
      return lista?.length ? Math.min(...lista.map((a) => ordemSev(a.severidade))) : 9;
    };
    const mapa = new Map<string, Objeto[]>();
    for (const o of visiveis) mapa.set(o.tipo, [...(mapa.get(o.tipo) ?? []), o]);
    return [...mapa.entries()]
      .sort(([a], [b]) => ordemTipo(a) - ordemTipo(b) || a.localeCompare(b))
      .map(([tipo, lista]) => ({ tipo, lista: lista.sort((a, b) => peso(a) - peso(b) || idx.rotulo(a).localeCompare(idx.rotulo(b))) }));
  }, [visiveis, idx]);

  const tiposPresentes = [...new Set(daFonte.map((o) => o.tipo))].sort((a, b) => ordemTipo(a) - ordemTipo(b) || a.localeCompare(b));
  const filtros = q || tipos.length || situacoes.length;
  const opcoesSituacao: { value: Situacao; label: string }[] = [
    { value: "achado", label: "Com achado aberto" },
    ...(e.contratoVersao !== null ? [{ value: "fora" as const, label: "Fora do contrato" }] : []),
    { value: "alterado", label: "Alterado nos últimos 7 dias" },
    { value: "sem_uso", label: "Sem uso na semana" },
  ];

  return (
    <>
      {fontes.length > 1 && (
        <Segmented
          ariaLabel="Fonte"
          className="mb-3"
          value={fonte}
          onChange={setFonte}
          options={[
            { value: "todas", label: "Todas as fontes", count: topo.length },
            ...fontes.map((f) => ({ value: f.id, label: f.nome, count: topo.filter((o) => o.fonte.id === f.id).length })),
          ]}
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nome ou chave" className="w-full sm:w-[280px]" />
        <MultiSelectChip
          label="Tipo"
          value={tipos}
          onChange={setTipos}
          options={tiposPresentes.map((t) => ({ value: t, label: TIPO_OBJETO[t] ?? t, count: daFonte.filter((o) => o.tipo === t).length }))}
        />
        <MultiSelectChip
          label="Situação"
          value={situacoes}
          onChange={setSituacoes}
          options={opcoesSituacao.map((s) => ({ ...s, count: daFonte.filter((o) => situacao(o, s.value)).length }))}
        />
        {filtros ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setTipos([]);
              setSituacoes([]);
            }}
          >
            Limpar filtros
          </Button>
        ) : null}
        <span className="ml-auto text-[12px] text-ink-3 tnum">
          {visiveis.length} de {daFonte.length}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className={cn("hidden gap-x-4 border-b border-line bg-sunken px-5 py-2 text-[11.5px] font-medium text-ink-3 @4xl:grid", COLS)}>
          <span>Objeto</span>
          <span>Fonte</span>
          <span>Uso · 7 dias</span>
          <span>Achados</span>
          <span className="text-right">Última mudança</span>
        </div>
        {grupos.length ? (
          grupos.map((g) => (
            <div key={g.tipo}>
              <div className="flex items-center gap-2 border-b border-line bg-subtle/60 px-5 py-1.5 text-[11.5px] font-medium text-ink-3">
                <ObjetoIcon tipo={g.tipo} className="size-3.5" />
                {TIPO_PLURAL[g.tipo] ?? TIPO_OBJETO[g.tipo] ?? g.tipo}
                <span className="text-ink-4 tnum">{g.lista.length}</span>
              </div>
              <div className="divide-y divide-line border-b border-line last:border-b-0">
                {g.lista.map((o) => {
                  const achados = idx.achados.get(o.chave);
                  const decl = declaracaoDe(e.declarados, o);
                  const fora = e.contratoVersao !== null && declaravel(o) && !decl;
                  const estado = estadoDosAchados(achados);
                  return (
                    <button
                      key={o.chave}
                      type="button"
                      onClick={() => setSearchParam("objeto", o.chave)}
                      className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-3 text-left transition-colors hover:bg-subtle", COLS)}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-[7px] border border-line bg-subtle text-ink-2 [&_svg]:size-3.5">
                          <ObjetoIcon tipo={o.tipo} />
                        </span>
                        <span className="min-w-0">
                          <span className={cn("block truncate text-ink", o.tipo === "workflow" || o.tipo === "credencial" ? "text-[13px] font-medium" : "font-mono text-[12px]")} title={o.chave}>
                            {idx.rotulo(o)}
                          </span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
                            {TIPO_OBJETO[o.tipo] ?? o.tipo}
                            {decl && ` · ${descreverDeclaracao(decl)}`}
                            {fora && <span className="text-warn-ink"> · fora do contrato</span>}
                          </span>
                        </span>
                      </span>
                      <span className="hidden min-w-0 items-center gap-1.5 text-[12.5px] text-ink-2 @4xl:flex">
                        <FonteIcon tipo={o.fonte.tipo} className="size-3.5 shrink-0 text-ink-3" />
                        <span className="truncate">{o.fonte.nome}</span>
                      </span>
                      <span className="hidden min-w-0 @4xl:block">
                        <Uso o={o} />
                      </span>
                      <span className="inline-flex items-center justify-end gap-1.5 text-[12.5px] text-ink-2 tnum @4xl:justify-start">
                        {estado && achados ? (
                          <>
                            <StatusDot status={estado} className="size-1.5" />
                            {achados.length}
                          </>
                        ) : (
                          <span className="text-ink-4">—</span>
                        )}
                      </span>
                      <span className="hidden text-right text-[12px] text-ink-3 tnum @4xl:block" title={o.alteradoEm ? "alterado" : "coletado pela primeira vez"}>
                        {relativo(o.alteradoEm ?? o.vistoDesde, e.agora)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            icon={<Boxes className="size-5" />}
            title={daFonte.length ? "Nenhum objeto com esses filtros" : "Nada coletado ainda"}
            description={daFonte.length ? "Ajuste a busca ou limpe os filtros." : "Rode a coleta do projeto para preencher o inventário."}
          />
        )}
      </Card>
    </>
  );
}

/** Inventário do projeto e a gaveta de detalhe do objeto (`?objeto=`). */
export function Inventario({ e }: { e: EstruturaProjeto }) {
  return (
    <>
      <Tabela e={e} />
      <Suspense fallback={null}>
        <ObjetoDrawer e={e} />
      </Suspense>
    </>
  );
}

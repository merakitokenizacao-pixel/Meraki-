"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { activeProject, agenteHref } from "@/components/shell/nav";
import { Mono, Pill } from "@/components/ui/misc";
import { ObjetoIcon } from "@/components/ui/objeto-icon";
import { Sheet } from "@/components/ui/sheet";
import { SevChip, StatusDot } from "@/components/ui/status";
import { estadoDosAchados } from "@/lib/plataforma/fluxo";
import {
  type Achado,
  type EstruturaProjeto,
  type Objeto,
  RELACAO,
  SEV,
  TIPO_OBJETO,
  declaracaoDe,
  nomeDaChave,
  ordemSev,
  partes,
  piorSeveridade,
} from "@/lib/plataforma/modelo";
import {
  type GrupoRelacao,
  type Indice,
  declaravel,
  descreverDeclaracao,
  indexar,
  ordenarTipos,
  relacoesDe,
  resolverChave,
} from "@/lib/plataforma/objetos";
import { dataHora } from "@/lib/tempo";
import { fmtInt } from "@/lib/format";
import { setSearchParam, setSearchParams } from "@/lib/url";
import { cn } from "@/lib/utils";
import { Bloco, MetaGrid, SectionTitle } from "./comum";

type A = Record<string, unknown>;

const simNao = (v: unknown) => (v === true ? "Sim" : v === false ? "Não" : "—");
const texto = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join(", ") : "—") : v === null || v === undefined || v === "" ? "—" : String(v));
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

const MUDANCA: Record<string, string> = {
  novo: "Apareceu na coleta",
  alterado: "Alterado",
  removido: "Removido",
  restaurado: "Voltou a aparecer",
};

/** Tipos com nome de gente (workflow, credencial, node) — texto normal em vez de monoespaçado. */
const HUMANOS = new Set(["workflow", "credencial", "node", "agente", "prompt"]);

const ORDEM_FILHOS = ["coluna", "constraint", "indice", "policy", "gatilho", "node", "chamada"];
const TITULO_FILHOS: Record<string, string> = {
  coluna: "Colunas",
  constraint: "Restrições",
  indice: "Índices",
  policy: "Policies",
  gatilho: "Gatilhos",
  node: "Nodes",
  chamada: "Chamadas ao banco",
};

/** Atributos coletados que importam para cada tipo, já em texto. */
function meta(o: Objeto): { label: string; value: React.ReactNode }[] {
  const a = o.atributos as A;
  const u = o.uso;
  switch (o.tipo) {
    case "tabela":
      return [
        { label: "RLS", value: a.rls ? (a.rls_forcado ? "Ativo e forçado" : "Ativo") : "Desligado" },
        { label: "Linhas", value: u?.vazia ? "vazia" : u?.linhas != null ? fmtInt(u.linhas) : "—" },
        { label: "Leituras · 7 dias", value: u ? fmtInt(u.leituras) : "—" },
        { label: "Escritas · 7 dias", value: u ? fmtInt(u.escritas) : "—" },
      ];
    case "visao":
      return [
        { label: "Security invoker", value: simNao(a.security_invoker) },
        { label: "Materializada", value: simNao(a.materializada) },
        { label: "Schema", value: texto(a.schema) },
      ];
    case "funcao":
      return [
        { label: "Linguagem", value: texto(a.linguagem) },
        { label: "Retorno", value: <Mono>{texto(a.retorno)}</Mono> },
        { label: "Security definer", value: simNao(a.security_definer) },
        { label: "search_path", value: str(a.search_path) ? <Mono>{String(a.search_path)}</Mono> : "não fixado" },
        { label: "Volatilidade", value: texto(a.volatilidade) },
        { label: "SQL dinâmico", value: simNao(a.sql_dinamico) },
        { label: "Executável por anon", value: simNao(a.exec_anon) },
        { label: "Chamadas · 7 dias", value: u ? fmtInt(u.leituras + u.escritas) : "—" },
      ];
    case "workflow":
      return [
        { label: "Ativo", value: simNao(a.ativo) },
        { label: "Publicado", value: simNao(a.publicado) },
        { label: "Rascunho diferente", value: simNao(a.divergente) },
        { label: "Trata erros", value: simNao(a.trata_erros) },
        { label: "Gatilhos", value: texto(a.gatilhos) },
        { label: "Tags", value: texto(a.tags) },
      ];
    case "arquivo":
      return [
        { label: "Chamadas ao banco", value: texto(a.chamadas) },
        { label: "Variáveis de ambiente", value: Array.isArray(a.envs) ? a.envs.length : "—" },
      ];
    case "rota":
      return [
        { label: "Métodos", value: texto(a.metodos) },
        { label: "Verifica sessão", value: simNao(a.verifica_sessao) },
        { label: "Arquivo", value: <Mono>{texto(a.arquivo)}</Mono> },
      ];
    case "env":
      return [
        { label: "Pública (vai ao navegador)", value: simNao(a.publica) },
        { label: "Parece segredo", value: simNao(a.parece_segredo) },
        { label: "Arquivos", value: texto(a.arquivos) },
      ];
    case "papel":
      return [
        { label: "Login", value: simNao(a.login) },
        { label: "Ignora RLS", value: simNao(a.ignora_rls) },
        { label: "Superusuário", value: simNao(a.superusuario) },
      ];
    case "credencial":
      return [
        { label: "Nome", value: texto(a.nome) },
        { label: "Tipo", value: <Mono>{texto(a.tipo)}</Mono> },
      ];
    case "bucket":
      return [{ label: "Público", value: simNao(a.publico) }];
    case "extensao":
      return [
        { label: "Schema", value: texto(a.schema) },
        { label: "Versão", value: texto(a.versao) },
      ];
    case "migracao":
      return [
        { label: "Versão", value: texto(a.versao ?? a.arquivo) },
        { label: "Objetos criados", value: Array.isArray(a.objetos_criados) ? a.objetos_criados.length : "—" },
      ];
    case "coluna":
      return [
        { label: "Tipo", value: <Mono>{texto(a.tipo)}</Mono> },
        { label: "Obrigatória", value: simNao(a.obrigatoria) },
        { label: "Padrão", value: str(a.padrao) ? <Mono>{String(a.padrao)}</Mono> : "—" },
        { label: "Gerada", value: simNao(a.gerada) },
      ];
    case "policy":
      return [
        { label: "Comando", value: texto(a.comando) },
        { label: "Papéis", value: texto(a.papeis) },
        { label: "Permissiva", value: simNao(a.permissiva) },
      ];
    case "constraint":
      return [
        { label: "Tipo", value: texto(a.tipo) },
        { label: "Colunas", value: texto(a.colunas) },
        { label: "Referência", value: texto(a.referencia) },
      ];
    case "indice":
      return [
        { label: "Único", value: simNao(a.unico) },
        { label: "Primário", value: simNao(a.primario) },
        { label: "Colunas", value: texto(a.colunas) },
      ];
    case "gatilho":
      return [
        { label: "Função", value: <Mono>{nomeDaChave(texto(a.funcao))}</Mono> },
        { label: "Habilitado", value: simNao(a.habilitado) },
      ];
    case "node":
      return [
        { label: "Tipo", value: <Mono>{texto(a.tipo).replace("n8n-nodes-base.", "")}</Mono> },
        { label: "Operação", value: texto(a.operacao) },
        { label: "Desativado", value: simNao(a.desativado) },
        { label: "Credenciais", value: texto(a.credenciais) },
      ];
    case "agente": {
      const nomeDe = (v: unknown) => texto((v as A | null)?.nome);
      return [
        { label: "Versão no ar", value: str(a.versao) ? <Mono>v{String(a.versao).slice(0, 8)}</Mono> : "—" },
        { label: "Rascunho diferente", value: simNao(a.rascunho_divergente) },
        { label: "Modelo", value: nomeDe(a.modelo) },
        { label: "Fallback", value: a.fallback ? nomeDe(a.fallback) : "nenhum" },
        { label: "Tools", value: Array.isArray(a.tools) ? a.tools.length : "—" },
        { label: "Entrada ramificada", value: simNao(a.entrada_ramificada) },
        { label: "Avaliação no n8n", value: simNao(a.avaliacao_nativa) },
        { label: "Desvia o ensaio", value: simNao(a.desvia_ensaio) },
      ];
    }
    case "prompt":
      return [
        { label: "Tamanho", value: `${fmtInt(Number(a.tamanho ?? 0))} caracteres` },
        { label: "Exemplos literais", value: texto(a.exemplos) },
        { label: "Lê $json direto", value: simNao(a.le_json) },
        { label: "Versão", value: <Mono>{texto(a.hash).slice(0, 8)}</Mono> },
      ];
    case "chamada":
      return [
        { label: "Via", value: <Mono>{texto(a.via)}</Mono> },
        { label: "Alvo", value: <Mono>{texto(a.alvo)}</Mono> },
        { label: "Operação", value: texto(a.operacao) },
        { label: "Colunas", value: texto(a.colunas) },
      ];
    default:
      return [];
  }
}

/** Código que explica o objeto: corpo da função, definição da visão, expressão da policy, consulta do node. */
function codigo(o: Objeto): { titulo: string; texto: string }[] {
  const a = o.atributos as A;
  if (o.tipo === "funcao") {
    const params = Array.isArray(a.parametros)
      ? (a.parametros as { nome?: string; tipo?: string; padrao?: boolean }[]).map((p) => `${p.nome ? `${p.nome} ` : ""}${p.tipo ?? ""}${p.padrao ? " = …" : ""}`).join(", ")
      : "";
    const assinatura = `${texto(a.schema)}.${texto(a.nome)}(${params}) returns ${texto(a.retorno)}`;
    return [{ titulo: "Assinatura", texto: assinatura }, ...(str(a.corpo) ? [{ titulo: `Corpo · ${texto(a.linguagem)}`, texto: String(a.corpo).trim() }] : [])];
  }
  if (o.tipo === "policy") {
    return [
      ...(str(a.usando) ? [{ titulo: "using", texto: String(a.usando) }] : []),
      ...(str(a.checagem) ? [{ titulo: "with check", texto: String(a.checagem) }] : []),
    ];
  }
  if (o.tipo === "prompt") {
    return [
      ...(str(a.sistema) ? [{ titulo: "Mensagem de sistema", texto: String(a.sistema).trim() }] : []),
      ...(str(a.entrada) ? [{ titulo: "Entrada", texto: String(a.entrada).trim() }] : []),
    ];
  }
  if (str(a.definicao)) return [{ titulo: "Definição", texto: String(a.definicao).trim() }];
  if (str(a.consulta)) return [{ titulo: "Consulta", texto: String(a.consulta).trim() }];
  return [];
}

function resumoFilho(o: Objeto): string {
  const a = o.atributos as A;
  switch (o.tipo) {
    case "coluna":
      return [texto(a.tipo), a.obrigatoria ? "obrigatória" : null, str(a.padrao) ? `padrão ${a.padrao}` : null].filter(Boolean).join(" · ");
    case "constraint":
      return str(a.definicao) ?? texto(a.tipo);
    case "indice":
      return [a.primario ? "primário" : a.unico ? "único" : null, texto(a.colunas)].filter(Boolean).join(" · ");
    case "policy":
      return [texto(a.comando), texto(a.papeis), str(a.usando)].filter(Boolean).join(" · ");
    case "gatilho":
      return [nomeDaChave(texto(a.funcao)), a.habilitado === false ? "desabilitado" : null].filter(Boolean).join(" · ");
    case "node":
      return [texto(a.tipo).replace("n8n-nodes-base.", ""), texto(a.operacao), a.desativado ? "desativado" : null].filter(Boolean).join(" · ");
    case "chamada":
      return [texto(a.operacao), `${texto(a.via)} ${texto(a.alvo)}`, a.dinamica ? "dinâmica" : null].filter(Boolean).join(" · ");
    default:
      return TIPO_OBJETO[o.tipo] ?? o.tipo;
  }
}

function abrirAchado(id: string) {
  setSearchParams({ objeto: null, achado: id });
}

function ListaAchadosDoObjeto({ achados }: { achados: Achado[] }) {
  const ordenados = [...achados].sort((a, b) => ordemSev(a.severidade) - ordemSev(b.severidade));
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[7px] border border-line">
      {ordenados.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={() => abrirAchado(a.id)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-subtle">
            <SevChip sev={a.severidade} className="mt-px" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{a.titulo}</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
                <span className="font-mono">{a.regra}</span> · {a.regraTitulo ?? "regra"}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Relacoes({ titulo, grupos, idx }: { titulo: string; grupos: GrupoRelacao[]; idx: Indice }) {
  if (!grupos.length) return null;
  return (
    <section>
      <SectionTitle aside={<span className="text-[12px] text-ink-3 tnum">{grupos.length}</span>}>{titulo}</SectionTitle>
      <ul className="divide-y divide-line overflow-hidden rounded-[7px] border border-line">
        {grupos.map((g) => {
          const o = idx.porChave.get(g.outro);
          const estado = estadoDosAchados(idx.achados.get(g.outro));
          const tipo = o?.tipo ?? partes(g.outro).tipo;
          const nota = [g.detalhes.size ? [...g.detalhes].join(", ") : null, g.via.size ? `via ${[...g.via].join(", ")}` : null].filter(Boolean).join(" · ");
          const corpo = (
            <>
              <span className="grid size-6 shrink-0 place-items-center rounded-[6px] border border-line bg-subtle text-ink-3 [&_svg]:size-3">
                <ObjetoIcon tipo={tipo} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  {estado && <StatusDot status={estado} className="size-1.5" />}
                  <span className={cn("truncate", HUMANOS.has(tipo) ? "text-[12.5px]" : "font-mono text-[12px]", o ? "text-ink" : "text-ink-3")} title={g.outro}>
                    {o ? idx.rotulo(o) : nomeDaChave(g.outro)}
                  </span>
                  {!o && <Pill className="h-[18px] px-1.5 text-[10.5px]">não coletado</Pill>}
                </span>
                {nota && <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{nota}</span>}
              </span>
              <span className="shrink-0 text-right text-[11.5px] text-ink-3">
                {ordenarTipos(g.tipos)
                  .map((t) => RELACAO[t]?.ida ?? t)
                  .join(" e ")}
                {g.inferida && <span className="block text-ink-4">inferida</span>}
              </span>
            </>
          );
          return (
            <li key={g.outro}>
              {o ? (
                <button type="button" onClick={() => setSearchParam("objeto", g.outro)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-subtle">
                  {corpo}
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">{corpo}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Fechar() {
  return (
    <button
      type="button"
      aria-label="Fechar painel"
      onClick={() => setSearchParam("objeto", null)}
      className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-[8px] text-ink-3 hover:bg-raised hover:text-ink"
    >
      <X className="size-4" />
    </button>
  );
}

/** Do objeto para a parte Agentes: casos, rodadas e produção ficam lá. */
function AbrirAgente({ chave }: { chave: string }) {
  const slug = activeProject(usePathname())?.slug;
  if (!slug) return null;
  return (
    <Link
      href={agenteHref(slug, chave)}
      className="inline-flex h-[22px] items-center gap-1 rounded-full border border-line-2 px-2 text-[11.5px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
    >
      Abrir agente
      <ArrowUpRight className="size-3" />
    </Link>
  );
}

function Detalhe({ o, e, idx }: { o: Objeto; e: EstruturaProjeto; idx: Indice }) {
  const achados = idx.achados.get(o.chave) ?? [];
  const pior = piorSeveridade(achados.map((a) => a.severidade));
  const decl = declaracaoDe(e.declarados, o);
  const fora = e.contratoVersao !== null && declaravel(o) && !decl;
  const pai = o.pai ? idx.porChave.get(o.pai) : undefined;
  const filhos = (idx.filhos.get(o.chave) ?? []).filter((f) => ORDEM_FILHOS.includes(f.tipo));
  const porTipo = ORDEM_FILHOS.map((t) => ({ tipo: t, lista: filhos.filter((f) => f.tipo === t) })).filter((g) => g.lista.length);
  const { usa, usadoPor } = useMemo(() => relacoesDe(o.chave, e, idx), [o.chave, e, idx]);
  const blocos = codigo(o);
  const itens = [
    ...meta(o),
    { label: "Coletado desde", value: dataHora(o.vistoDesde) },
    { label: "Última mudança", value: o.alteradoEm ? dataHora(o.alteradoEm) : "nenhuma" },
  ];

  return (
    <>
      <header className="flex items-start gap-3 border-b border-line px-6 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-[7px] border border-line bg-subtle text-ink-2 [&_svg]:size-4">
          <ObjetoIcon tipo={o.tipo} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={cn("truncate text-ink", HUMANOS.has(o.tipo) ? "text-[15px] font-medium" : "font-mono text-[14px]")} title={o.chave}>
            {idx.rotulo(o)}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-3">
            {TIPO_OBJETO[o.tipo] ?? o.tipo} · {o.fonte.nome}
            {o.pai && (
              <>
                {" "}
                · em{" "}
                <button type="button" onClick={() => setSearchParam("objeto", o.pai)} className="font-mono text-[12px] text-ink-2 hover:text-ink hover:underline">
                  {pai ? idx.rotulo(pai) : nomeDaChave(o.pai)}
                </button>
              </>
            )}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {pior ? (
              <SevChip sev={pior} />
            ) : (
              <Pill>
                <StatusDot status="ok" className="size-[7px]" />
                Sem achado aberto
              </Pill>
            )}
            {decl && <Pill title="O que o contrato diz deste objeto">{descreverDeclaracao(decl)}</Pill>}
            {fora && <Pill className="text-warn-ink">fora do contrato</Pill>}
            {o.tipo === "agente" && <AbrirAgente chave={o.chave} />}
          </div>
        </div>
        <Fechar />
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5 scrollbar-thin">
        <MetaGrid items={itens} cols={3} />

        {(decl?.nota || decl?.primitiva || decl?.escritorDe || fora) && (
          <section>
            <SectionTitle>No contrato</SectionTitle>
            <div className="rounded-[7px] border border-line-2 bg-subtle p-4 text-[13px] leading-relaxed text-ink-2">
              {fora ? (
                <p>
                  Não declarado. Mudanças nele passam pelo gate como estrutura desconhecida (E01): declare em <Mono>objetos</Mono> ou registre uma proposta.
                </p>
              ) : (
                <>
                  {decl?.primitiva && (
                    <p>
                      Faz parte da primitiva <span className="text-ink">{decl.primitiva}</span>.
                    </p>
                  )}
                  {decl?.escritorDe && (
                    <p>
                      Autorizado a escrever na primitiva <span className="text-ink">{decl.escritorDe}</span>.
                    </p>
                  )}
                  {decl?.nota && <p className="mt-1 text-ink-3">{decl.nota}</p>}
                </>
              )}
            </div>
          </section>
        )}

        {achados.length > 0 && (
          <section>
            <SectionTitle aside={<span className="text-[12px] text-ink-3">{pior && SEV[pior].label} no pior caso</span>}>
              Achados abertos · {achados.length}
            </SectionTitle>
            <ListaAchadosDoObjeto achados={achados} />
          </section>
        )}

        {blocos.map((b) => (
          <section key={b.titulo}>
            <SectionTitle>{b.titulo}</SectionTitle>
            <Bloco>{b.texto}</Bloco>
          </section>
        ))}

        {porTipo.map((g) => (
          <section key={g.tipo}>
            <SectionTitle aside={<span className="text-[12px] text-ink-3 tnum">{g.lista.length}</span>}>{TITULO_FILHOS[g.tipo]}</SectionTitle>
            <ul className="divide-y divide-line overflow-hidden rounded-[7px] border border-line">
              {g.lista.map((f) => {
                const estado = estadoDosAchados(idx.achados.get(f.chave));
                return (
                  <li key={f.chave}>
                    <button
                      type="button"
                      onClick={() => setSearchParam("objeto", f.chave)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-subtle"
                    >
                      <span className="flex w-[34%] min-w-0 shrink-0 items-center gap-1.5">
                        {estado && <StatusDot status={estado} className="size-1.5" />}
                        <span className={cn("truncate text-[12.5px] text-ink", g.tipo !== "node" && "font-mono text-[12px]")} title={f.chave}>
                          {g.tipo === "chamada" ? `linha ${String((f.atributos as A).linha ?? "?")}` : f.nome}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-3">{resumoFilho(f)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <Relacoes titulo="Usa" grupos={usa} idx={idx} />
        <Relacoes titulo="Usado por" grupos={usadoPor} idx={idx} />

        {o.versoes.length > 0 && (
          <section>
            <SectionTitle>Histórico</SectionTitle>
            <ol className="space-y-2">
              {o.versoes.map((v, i) => (
                <li key={`${v.criadoEm}-${i}`} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="text-ink-2">{MUDANCA[v.mudanca] ?? v.mudanca}</span>
                  <span className="text-ink-3 tnum">{dataHora(v.criadoEm)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <details className="group">
          <summary className="cursor-pointer text-[12.5px] text-ink-3 select-none hover:text-ink-2">Atributos coletados</summary>
          <Bloco className="mt-3">{JSON.stringify(o.atributos, null, 2)}</Bloco>
        </details>
      </div>
    </>
  );
}

/** Referência que algum consumidor usa mas que não existe nas fontes coletadas. */
function NaoColetado({ chave, e, idx }: { chave: string; e: EstruturaProjeto; idx: Indice }) {
  const achados = e.achados.filter((a) => a.status === "aberto" && (a.objeto === chave || a.par === chave));
  const { usadoPor } = useMemo(() => relacoesDe(chave, e, idx), [chave, e, idx]);
  const tipo = partes(chave).tipo;
  return (
    <>
      <header className="flex items-start gap-3 border-b border-line px-6 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-[7px] border border-dashed border-line-2 bg-surface text-ink-3 [&_svg]:size-4">
          <ObjetoIcon tipo={tipo} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-[14px] text-ink" title={chave}>
            {nomeDaChave(chave)}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{TIPO_OBJETO[tipo] ?? "Objeto"} · referência sem objeto coletado</p>
        </div>
        <Fechar />
      </header>
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5 scrollbar-thin">
        <p className="rounded-[7px] border border-line-2 bg-subtle p-4 text-[13px] leading-relaxed text-ink-2">
          Algum consumidor aponta para este nome, mas ele não existe em nenhuma fonte coletada do projeto: pode ter sido removido, renomeado ou estar em outro banco.
        </p>
        {achados.length > 0 && (
          <section>
            <SectionTitle>Achados abertos · {achados.length}</SectionTitle>
            <ListaAchadosDoObjeto achados={achados} />
          </section>
        )}
        <Relacoes titulo="Referenciado por" grupos={usadoPor} idx={idx} />
      </div>
    </>
  );
}

/** Gaveta controlada por `?objeto=` — precisa estar dentro de <Suspense>. */
export function ObjetoDrawer({ e }: { e: EstruturaProjeto }) {
  const params = useSearchParams();
  const idx = useMemo(() => indexar(e), [e]);
  const pedido = params.get("objeto");
  const chave = pedido ? resolverChave(pedido, idx) : null;
  // Mantém o último objeto visível durante a animação de saída.
  const [shown, setShown] = useState(chave);
  if (chave && chave !== shown) setShown(chave);
  const o = shown ? idx.porChave.get(shown) : undefined;

  return (
    <Sheet open={!!chave} onClose={() => setSearchParam("objeto", null)} label={shown ? `Objeto ${nomeDaChave(shown)}` : "Detalhes do objeto"} width={680}>
      {shown && (o ? <Detalhe key={shown} o={o} e={e} idx={idx} /> : <NaoColetado key={shown} chave={shown} e={e} idx={idx} />)}
    </Sheet>
  );
}

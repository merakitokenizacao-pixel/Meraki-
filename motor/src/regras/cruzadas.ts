/** Pacotes cruzado (X01–X05), n8n (N01–N03) e repositório (R01): o que as fontes dizem umas das outras. */
import { chave, partes, schemaDe } from "../chaves.ts";
import type { AchadoBruto } from "../tipos.ts";
import { type Regra, exibir, noEscopo, numero, workflowDoNode } from "./base.ts";

const REFERENCIAVEIS = new Set(["tabela", "visao", "coluna", "funcao"]);

export const X01: Regra = {
  codigo: "X01", pacote: "cruzada", severidade: "critico", bloqueia: true, alvo: "relacao",
  titulo: "Referência quebrada",
  descricao: "Um consumidor (node, código, função, visão) aponta para algo que não existe na fonte.",
  avaliar: (ctx) => {
    const saida: AchadoBruto[] = [];
    // Tool de agente com alvo quebrado sai como A03, com o agente no achado.
    const a03 = ctx.intencao.regraLigada({ codigo: "A03", pacote: "agente" });
    for (const r of ctx.grafo.relacoes) {
      if (r.certeza !== "exata" || ctx.grafo.tem(r.destino) || !ctx.grafo.tem(r.origem)) continue;
      if (a03 && ctx.grafo.get(r.origem)?.atributos.tool) continue;
      const p = partes(r.destino);
      if (p.ns === "pg") {
        if (!REFERENCIAVEIS.has(p.tipo) || !ctx.grafo.coletaSchema(schemaDe(r.destino) ?? "public")) continue;
        if (ctx.intencao.ignorado(r.destino)) continue;
      } else if (p.ns === "n8n") {
        if (!ctx.grafo.temFonte("n8n")) continue;
      } else continue;
      const onde = r.origem.startsWith("n8n:node:") ? ` (${workflowDoNode(ctx.grafo, r.origem)})` : "";
      saida.push({
        regra: "X01", objeto: r.origem, par: r.destino, severidade: "critico",
        titulo: `${exibir(r.origem)}${onde} ${r.tipo === "chama" ? "chama" : r.tipo === "escreve" ? "grava em" : "lê"} ${exibir(r.destino).replace(/\(\*\)$/, "")}, que não existe`,
        detalhe: "Vai falhar na próxima execução. Corrija o nome ou recrie o objeto.",
        evidencia: { ...r.evidencia, objeto: r.origem, par: r.destino },
      });
    }
    return saida;
  },
};

export const X02: Regra = {
  codigo: "X02", pacote: "cruzada", severidade: "medio", bloqueia: false, alvo: "relacao:le",
  titulo: "Lógica lendo coluna vazia",
  descricao: "Código ou automação depende de uma coluna que nunca tem valor.",
  avaliar: (ctx) =>
    ctx.grafo.relacoes.flatMap((r): AchadoBruto[] => {
      if (r.tipo !== "le" || !r.destino.startsWith("pg:coluna:") || !ctx.grafo.tem(r.origem)) return [];
      if (ctx.grafo.ultimoUso(r.destino, "pg_stats")?.vazia !== true || ctx.intencao.opcionalPorDesign(r.destino)) return [];
      return [{
        regra: "X02", objeto: r.origem, par: r.destino, severidade: "medio",
        titulo: `${exibir(r.origem)} lê ${exibir(r.destino)}, que está sempre vazia`,
        detalhe: "A lógica trata um dado que nunca chega. Remova a leitura ou preencha a coluna na origem.",
        evidencia: { ...r.evidencia, objeto: r.origem, par: r.destino },
      }];
    }),
};

export const X03: Regra = {
  codigo: "X03", pacote: "cruzada", severidade: "medio", bloqueia: false, alvo: "pg:funcao",
  titulo: "Parâmetro de função nunca passado",
  descricao: "Nenhum chamador conhecido passa um parâmetro obrigatório da função.",
  avaliar: (ctx) => {
    const saida: AchadoBruto[] = [];
    for (const f of noEscopo(ctx, "funcao")) {
      const chamadas = ctx.grafo.entrando(f.chave, "chama").filter((r) => Array.isArray(r.evidencia.argumentos));
      if (!chamadas.length) continue;
      const passados = new Set(chamadas.flatMap((r) => r.evidencia.argumentos as string[]));
      for (const p of (f.atributos.parametros as { nome: string; padrao: boolean }[]) ?? []) {
        if (p.padrao || passados.has(p.nome)) continue;
        saida.push({
          regra: "X03", objeto: f.chave, variante: p.nome, severidade: "medio",
          titulo: `${p.nome} de ${exibir(f.chave)} nunca é passado`,
          detalhe: `${chamadas.length} chamada(s) conhecida(s), nenhuma com ${p.nome}. A chamada falha ou o parâmetro sobra.`,
          evidencia: { objeto: f.chave, parametro: p.nome, chamadas: chamadas.map((r) => r.origem) },
        });
      }
    }
    return saida;
  },
};

export const X04: Regra = {
  codigo: "X04", pacote: "cruzada", severidade: "medio", bloqueia: false, alvo: "repo:chamada",
  titulo: "Consulta sem limite em tabela acima do teto da API",
  descricao: "A API do Supabase devolve no máximo 1.000 linhas: sem .range()/.limit() o resto some sem erro.",
  avaliar: (ctx) => {
    const limite = numero(ctx.ajuste, "linhas", 1000);
    return ctx.grafo.porTipo("chamada").flatMap((c): AchadoBruto[] => {
      if (c.atributos.via !== "from" || c.atributos.operacao !== "select" || c.atributos.limitada) return [];
      const tabela = ctx.grafo.saindo(c.chave, "le").find((r) => r.destino.startsWith("pg:tabela:"))?.destino;
      const linhas = tabela ? ctx.grafo.ultimoUso(tabela, "pg_stat_user_tables")?.linhas : undefined;
      if (!tabela || !linhas || linhas <= limite) return [];
      return [{
        regra: "X04", objeto: c.chave, par: tabela, severidade: "medio",
        titulo: `${exibir(c.chave)} lê ${exibir(tabela)} (${linhas} linhas) sem limite`,
        detalhe: `Acima de ${limite} linhas a API corta o resultado. Pagine com .range().`,
        evidencia: { objeto: c.chave, par: tabela, linhas },
      }];
    });
  },
};

/** Só no gate: o delta remove ou renomeia algo que tem consumidor. */
export const X05: Regra = {
  codigo: "X05", pacote: "cruzada", severidade: "critico", bloqueia: true, alvo: "delta",
  titulo: "DROP/RENAME que quebra um consumidor",
  descricao: "A mudança remove ou renomeia um objeto que alguém ainda usa.",
  avaliar: (ctx) => {
    const removidos = ctx.removidos;
    if (!removidos?.size) return [];
    const saida: AchadoBruto[] = [];
    for (const [k] of removidos) {
      const consumidores = ctx.grafo.entrando(k).filter((r) => !removidos.has(r.origem) && !/^pg:(policy|gatilho|constraint):/.test(r.origem) && r.tipo !== "referencia");
      if (!consumidores.length) continue;
      saida.push({
        regra: "X05", objeto: k, severidade: "critico",
        titulo: `Remover ${exibir(k)} quebra ${consumidores.length} consumidor(es)`,
        detalhe: `Ainda usam: ${[...new Set(consumidores.map((r) => exibir(r.origem)))].slice(0, 5).join(", ")}.`,
        evidencia: { objeto: k, consumidores: consumidores.map((r) => r.origem).slice(0, 20) },
      });
    }
    return saida;
  },
};

export const N01: Regra = {
  codigo: "N01", pacote: "n8n", severidade: "medio", bloqueia: false, alvo: "n8n:workflow",
  titulo: "Workflow ativo sem workflow de erro",
  descricao: "Quando falha, ninguém fica sabendo.",
  avaliar: (ctx) =>
    ctx.grafo
      .porTipo("workflow")
      // O próprio workflow de erro (Error Trigger) não precisa de outro.
      .filter((w) => w.atributos.ativo && !w.atributos.error_workflow && !w.atributos.trata_erros)
      .map((w) => ({
        regra: "N01", objeto: w.chave, severidade: "medio",
        titulo: `Workflow "${w.nome}" está ativo sem workflow de erro`,
        detalhe: "Defina settings.errorWorkflow para a falha virar alerta.",
        evidencia: { objeto: w.chave, workflow: w.nome },
      })),
};

export const N02: Regra = {
  codigo: "N02", pacote: "n8n", severidade: "medio", bloqueia: false, alvo: "n8n:workflow",
  titulo: "Rascunho diferente do publicado",
  descricao: "Alguém editou e não publicou: o que roda não é o que está na tela.",
  avaliar: (ctx) => {
    const horas = numero(ctx.ajuste, "horas", 24);
    return ctx.grafo.porTipo("workflow").flatMap((w): AchadoBruto[] => {
      const editado = w.atributos.rascunho_editado_em as string | null;
      if (!w.atributos.divergente || !editado) return [];
      const passadas = (ctx.agora.getTime() - Date.parse(editado)) / 3_600_000;
      if (passadas < horas) return [];
      return [{
        regra: "N02", objeto: w.chave, severidade: "medio",
        titulo: `Workflow "${w.nome}" tem rascunho diferente do publicado há ${Math.floor(passadas / 24)} dia(s)`,
        detalhe: "Publique ou descarte o rascunho.",
        evidencia: { objeto: w.chave, rascunho_editado_em: editado, versao_publicada: w.atributos.versao_publicada },
      }];
    });
  },
};

export const N03: Regra = {
  codigo: "N03", pacote: "n8n", severidade: "alto", bloqueia: false, alvo: "n8n:node",
  titulo: "Credencial que não é do projeto",
  descricao: "Node usando uma credencial fora da lista de consumidores do contrato.",
  avaliar: (ctx) => {
    const permitidas = new Set(ctx.intencao.contrato.consumidores.credenciais.flatMap((c) => ctx.intencao.chavesDe(c)));
    if (!permitidas.size) return [];
    const saida: AchadoBruto[] = [];
    for (const n of ctx.grafo.porTipo("node")) {
      for (const id of (n.atributos.credenciais as string[]) ?? []) {
        const k = chave.credencial(id);
        if (permitidas.has(k)) continue;
        const cred = ctx.grafo.get(k);
        saida.push({
          regra: "N03", objeto: n.chave, par: k, severidade: "alto",
          titulo: `${exibir(n.chave)} (${workflowDoNode(ctx.grafo, n.chave)}) usa a credencial "${cred?.nome ?? id}", que não é do projeto`,
          detalhe: "Troque pela credencial do projeto ou declare essa em consumidores.credenciais.",
          evidencia: { objeto: n.chave, par: k, credencial: cred?.nome ?? id },
        });
      }
    }
    return saida;
  },
};

export const R01: Regra = {
  codigo: "R01", pacote: "repo", severidade: "critico", bloqueia: false, alvo: "repo:env",
  titulo: "Segredo em variável NEXT_PUBLIC_",
  descricao: "Toda variável NEXT_PUBLIC_ vai para o navegador. Chave de serviço ali é chave pública.",
  avaliar: (ctx) =>
    ctx.grafo
      .porTipo("env")
      .filter((e) => e.atributos.publica && e.atributos.parece_segredo)
      .map((e) => ({
        regra: "R01", objeto: e.chave, severidade: "critico",
        titulo: `${e.nome} parece segredo e vai para o navegador`,
        detalhe: `Usada em ${((e.atributos.arquivos as string[]) ?? []).join(", ")}. Tire o prefixo NEXT_PUBLIC_, use só no servidor e gire a chave.`,
        evidencia: { objeto: e.chave, arquivos: e.atributos.arquivos },
      })),
};

export const CRUZADAS: Regra[] = [X01, X02, X03, X04, X05, N01, N02, N03, R01];

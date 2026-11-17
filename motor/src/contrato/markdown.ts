/** Cópia legível e só de leitura do contrato, gravada em .meraki/contrato.md para o agente consultar. */
import { REGRAS } from "../regras/index.ts";
import type { Contrato } from "./esquema.ts";

export function contratoEmMarkdown(c: Contrato, contexto: { geradoEm: Date; autor?: string; abertos?: Record<string, number> }): string {
  const l: string[] = [];
  l.push(`# Contrato · ${c.projeto} · v${c.versao}`, "");
  l.push(`> Cópia só de leitura gerada pelo Meraki em ${contexto.geradoEm.toISOString().slice(0, 16).replace("T", " ")} UTC.`);
  l.push("> Não edite este arquivo: o hook nega escrita em .meraki/. Para mudar a estrutura, proponha:");
  l.push(`> \`meraki propor --projeto ${c.projeto} --tipo nova_tabela --sql migration.sql --justificativa "..."\``, "");

  const prims = Object.entries(c.primitivas);
  l.push("## Primitivas", "");
  if (!prims.length) l.push("_Nenhuma primitiva declarada ainda._", "");
  for (const [nome, p] of prims) {
    l.push(`- **${nome}** — ${p.descricao ?? "sem descrição"}`);
    l.push(`  - dona: \`${p.dona}\`${p.vinculo ? ` · vínculo: \`${p.vinculo}\`` : ""}`);
    if (p.escritores.length) l.push(`  - só escrevem: ${p.escritores.map((e) => `\`${e}\``).join(", ")}`);
  }
  if (prims.length) l.push("");

  const declarados = Object.entries(c.objetos).filter(([, o]) => o.declarado !== false);
  const pendentes = Object.entries(c.objetos).filter(([, o]) => o.declarado === false);
  l.push("## Objetos declarados", "");
  if (!declarados.length) l.push("_Nenhum objeto declarado._", "");
  else {
    l.push("| Objeto | Papel | Primitiva | Nota |", "|---|---|---|---|");
    for (const [ref, o] of declarados) {
      l.push(`| \`${ref}\` | ${o.papel ?? ""} | ${o.primitiva ?? ""} | ${(o.nota ?? (o.opcional_por_design ? "opcional por design" : "")).replace(/\|/g, "/")} |`);
    }
    l.push("");
  }
  if (pendentes.length) l.push(`_${pendentes.length} objeto(s) ainda não declarados (dívida herdada)._`, "");

  l.push("## Convenções", "");
  l.push(`- Colunas genéricas: ${c.convencoes.colunas_genericas.join(", ")}`);
  if (c.convencoes.parametro_de_escopo) l.push(`- Parâmetro de escopo: \`${c.convencoes.parametro_de_escopo}\` — valide com ${c.convencoes.validadores_de_escopo.map((v) => `\`${v}\``).join(" ou ")}`);
  l.push(`- Schemas: ${c.escopo.schemas.join(", ")}${c.escopo.ignorar.length ? ` · ignorados: ${c.escopo.ignorar.join(", ")}` : ""}`, "");

  l.push("## O que o gate barra", "");
  for (const r of REGRAS.filter((x) => x.bloqueia)) l.push(`- **${r.codigo}** ${r.titulo}`);
  l.push("");

  if (c.excecoes.length) {
    l.push("## Exceções", "");
    for (const e of c.excecoes) l.push(`- ${e.regra} em ${e.objetos.join(", ")} até ${e.ate}: ${e.motivo}`);
    l.push("");
  }
  if (contexto.abertos) {
    const total = Object.values(contexto.abertos).reduce((s, n) => s + n, 0);
    l.push("## Achados abertos", "", `${total} no total · ${Object.entries(contexto.abertos).map(([s, n]) => `${n} ${s}`).join(" · ")}`, "");
  }
  return l.join("\n");
}

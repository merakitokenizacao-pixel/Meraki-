/** meraki contrato rascunho | publicar | mostrar */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { contratoParaYaml, lerContratoYaml } from "../contrato/esquema.ts";
import { gerarRascunho } from "../contrato/rascunho.ts";
import { carregarGrafo, contratoAtual, gravarContrato, projetoPorSlug } from "../plataforma/repositorio.ts";
import { type Argumentos, obrigatorio, texto } from "../util/args.ts";
import { verificarProjeto } from "../verificacao.ts";
import { contagem, out } from "./comum.ts";

export async function contrato(args: Argumentos): Promise<void> {
  const sub = args.posicionais[1];
  const projeto = await projetoPorSlug(obrigatorio(args, "projeto"));

  if (sub === "rascunho") {
    const grafo = await carregarGrafo(projeto.id);
    if (!grafo.objetos.size) throw new Error(`sem coleta para ${projeto.slug}: rode meraki coletar --projeto ${projeto.slug}`);
    const yaml = contratoParaYaml(
      gerarRascunho(projeto.slug, grafo, [...grafo.fontes.values()]),
      `Rascunho do contrato de ${projeto.slug}, gerado pelo Meraki em ${new Date().toISOString().slice(0, 10)}.\nTodo objeto começa não declarado: declare papel e primitiva e publique.`,
    );
    const saida = texto(args, "saida");
    if (saida) {
      await writeFile(resolve(saida), yaml);
      out(`rascunho gravado em ${saida}`);
    } else {
      process.stdout.write(yaml);
    }
    return;
  }

  if (sub === "publicar") {
    const arquivo = obrigatorio(args, "arquivo");
    const motivo = obrigatorio(args, "motivo");
    const conteudo = lerContratoYaml(await readFile(resolve(arquivo), "utf8"));
    if (conteudo.projeto !== projeto.slug) throw new Error(`o arquivo é do projeto ${conteudo.projeto}, não de ${projeto.slug}`);
    const versao = await gravarContrato(projeto, conteudo, texto(args, "autor") ?? "meraki-cli", motivo);
    const v = await verificarProjeto(projeto, { gravar: true });
    out(`contrato v${versao} publicado para ${projeto.slug}`);
    out(`  saúde ${v.saude} · cobertura ${v.cobertura}% · abertos: ${contagem(v.abertos)} · +${v.novos} novos · ${v.resolvidos} resolvidos`);
    return;
  }

  if (sub === "mostrar") {
    const atual = await contratoAtual(projeto.id);
    if (!atual) throw new Error(`${projeto.slug} ainda não tem contrato: rode meraki coletar`);
    process.stdout.write(contratoParaYaml(atual.conteudo, `Contrato v${atual.versao} de ${projeto.slug} · ${atual.autor}`));
    return;
  }

  throw new Error("use: meraki contrato rascunho|publicar|mostrar --projeto <slug>");
}

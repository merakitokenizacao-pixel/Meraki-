/** Saída de texto e seleção de projeto, comuns a todos os comandos. */
import { listarProjetos, projetoPorSlug, type Projeto } from "../plataforma/repositorio.ts";
import type { Severidade } from "../tipos.ts";
import { type Argumentos, flag, obrigatorio } from "../util/args.ts";

export function out(linha = ""): void {
  process.stdout.write(`${linha}\n`);
}

export async function projetosAlvo(args: Argumentos): Promise<Projeto[]> {
  if (flag(args, "todos")) return listarProjetos();
  return [await projetoPorSlug(obrigatorio(args, "projeto"))];
}

export function contagem(c: Record<Severidade, number>): string {
  return `${c.critico} crítico · ${c.alto} alto · ${c.medio} médio · ${c.baixo} baixo`;
}

export const ORDEM_SEVERIDADE: Record<Severidade, number> = { critico: 0, alto: 1, medio: 2, baixo: 3 };

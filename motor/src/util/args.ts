/** Parser mínimo de argumentos: posicionais e --chave valor | --chave=valor | --flag. */
export interface Argumentos {
  posicionais: string[];
  opcoes: Record<string, string | true>;
}

export function lerArgumentos(argv: string[]): Argumentos {
  const posicionais: string[] = [];
  const opcoes: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const corpo = arg.slice(2);
      const igual = corpo.indexOf("=");
      if (igual >= 0) {
        opcoes[corpo.slice(0, igual)] = corpo.slice(igual + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        opcoes[corpo] = argv[++i];
      } else {
        opcoes[corpo] = true;
      }
    } else {
      posicionais.push(arg);
    }
  }
  return { posicionais, opcoes };
}

export function texto(args: Argumentos, nome: string): string | undefined {
  const v = args.opcoes[nome];
  return typeof v === "string" ? v : undefined;
}

export function obrigatorio(args: Argumentos, nome: string): string {
  const v = texto(args, nome);
  if (!v) throw new Error(`faltou --${nome}`);
  return v;
}

export function flag(args: Argumentos, nome: string): boolean {
  return args.opcoes[nome] !== undefined && args.opcoes[nome] !== "false";
}

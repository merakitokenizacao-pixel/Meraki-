/**
 * Coletor de repositório (ts-morph). Lê o código, não executa nada:
 *  .from('<tabela>') com as colunas do .select · .rpc('<funcao>', {...}) · fetch para /rest/v1 e /functions/v1
 *  process.env.* (NEXT_PUBLIC_ marcado) · rotas app/.../route.ts · supabase/migrations (arquivos .sql)
 * Nome de tabela vindo de variável vira relação inferida.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { chave } from "../chaves.ts";
import { chavesCriadas } from "../sql/ddl.ts";
import { carregarParser, tentarLerComandos } from "../sql/parser.ts";
import type { Certeza, Coletor, ContextoColeta, FonteConfig, Objeto, Relacao, Snapshot } from "../tipos.ts";

const IGNORAR = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage", ".turbo", ".vercel", "out"]);
const CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const ESCRITA = new Set(["insert", "update", "upsert", "delete"]);
const LIMITE = new Set(["range", "limit", "single", "maybeSingle"]);
const SESSAO = /\b(getUser|getSession|getClaims|auth\(\)|currentUser|verifySession|requireAuth|requireUser|getServerSession)\b/;
const SEGREDO = /(SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|SENHA|TOKEN|API_KEY|APIKEY)/i;

async function listar(pasta: string, raiz: string, saida: string[] = []): Promise<string[]> {
  for (const nome of (await readdir(pasta)).sort()) {
    if (IGNORAR.has(nome) || nome.startsWith(".")) continue;
    const caminho = join(pasta, nome);
    const s = await stat(caminho);
    if (s.isDirectory()) await listar(caminho, raiz, saida);
    else saida.push(caminho);
  }
  return saida;
}

const posix = (p: string) => p.split(sep).join("/");

/** app/(painel)/api/contatos/[id]/route.ts → /api/contatos/:id */
function rotaDe(arquivo: string): string | null {
  const m = /(?:^|\/)app\/(.*)\/route\.(t|j)sx?$/.exec(arquivo);
  if (!m) return null;
  const partes = m[1].split("/").filter((p) => !/^\(.*\)$/.test(p)).map((p) => p.replace(/^\[\.\.\.(.+)\]$/, "*$1").replace(/^\[(.+)\]$/, ":$1"));
  return `/${partes.join("/")}`;
}

export const coletorRepo: Coletor = {
  tipos: ["repo"],

  async coletar(fonte: FonteConfig, ctx: ContextoColeta): Promise<Snapshot> {
    const caminho = fonte.config.caminho as string | undefined;
    if (!caminho) throw new Error("fonte repo precisa de config.caminho");
    const raizRepo = resolve(ctx.raiz, caminho);
    await carregarParser();
    const { Project, SyntaxKind, Node } = await import("ts-morph");

    const todos = await listar(raizRepo, raizRepo);
    const objetos = new Map<string, Objeto>();
    const relacoes: Relacao[] = [];
    const avisos: string[] = [];
    const envs = new Map<string, Set<string>>();
    const usoPorArquivo = new Map<string, { chamadas: number; envs: Set<string> }>();
    const anotarArquivo = (rel: string) => {
      if (!usoPorArquivo.has(rel)) usoPorArquivo.set(rel, { chamadas: 0, envs: new Set() });
      return usoPorArquivo.get(rel)!;
    };

    // Migrations do repositório
    for (const arq of todos.filter((f) => /supabase[\\/]migrations[\\/][^\\/]+\.sql$/.test(f))) {
      const rel = posix(relative(raizRepo, arq));
      const comandos = tentarLerComandos(await readFile(arq, "utf8"));
      if (!comandos) avisos.push(`migration ${rel} não pôde ser lida`);
      objetos.set(chave.migracaoArquivo(rel), {
        tipo: "migracao", chave: chave.migracaoArquivo(rel), nome: rel.split("/").pop()!, pai: null,
        atributos: { arquivo: rel, objetos_criados: comandos ? chavesCriadas(comandos, "supabase") : [] },
      });
    }

    const projeto = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true, compilerOptions: { allowJs: true } });
    for (const arq of todos.filter((f) => CODIGO.test(f))) projeto.addSourceFileAtPath(arq);

    for (const sf of projeto.getSourceFiles()) {
      const rel = posix(relative(raizRepo, sf.getFilePath()));
      const kArquivo = chave.arquivo(rel);

      // Rotas de API
      const rota = rotaDe(rel);
      if (rota) {
        const metodos = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => sf.getFunction(m)?.isExported() || sf.getVariableDeclaration(m)?.isExported());
        objetos.set(chave.rota(rota), {
          tipo: "rota", chave: chave.rota(rota), nome: rota, pai: kArquivo,
          atributos: { arquivo: rel, metodos, verifica_sessao: SESSAO.test(sf.getFullText()) },
        });
        anotarArquivo(rel);
      }

      // process.env.X
      for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const alvo = pa.getExpression();
        if (Node.isPropertyAccessExpression(alvo) && alvo.getText() === "process.env") {
          const nome = pa.getName();
          if (!envs.has(nome)) envs.set(nome, new Set());
          envs.get(nome)!.add(rel);
          anotarArquivo(rel).envs.add(nome);
        }
      }

      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        const linha = call.getStartLineNumber();
        const args = call.getArguments();
        const kChamada = chave.chamada(rel, linha);

        const textoLiteral = (n: unknown): { valor: string; certeza: Certeza } | null => {
          const no = n as import("ts-morph").Node | undefined;
          if (!no) return null;
          if (Node.isStringLiteral(no) || Node.isNoSubstitutionTemplateLiteral(no)) return { valor: no.getLiteralValue(), certeza: "exata" };
          if (Node.isIdentifier(no)) {
            const decl = no.getDefinitionNodes()[0];
            const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
            if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) return { valor: init.getLiteralValue(), certeza: "inferida" };
          }
          return null;
        };

        if (Node.isPropertyAccessExpression(expr) && expr.getName() === "from") {
          const t = textoLiteral(args[0]);
          // Sobe a cadeia .from(...).select(...).eq(...).range(...)
          const metodos: { nome: string; args: import("ts-morph").Node[] }[] = [];
          let atual: import("ts-morph").Node = call;
          while (true) {
            const pai = atual.getParent();
            if (pai && Node.isPropertyAccessExpression(pai) && pai.getExpression() === atual) {
              const avo = pai.getParent();
              if (avo && Node.isCallExpression(avo) && avo.getExpression() === pai) {
                metodos.push({ nome: pai.getName(), args: avo.getArguments() });
                atual = avo;
                continue;
              }
            }
            break;
          }
          const escrita = metodos.find((m) => ESCRITA.has(m.nome));
          const select = metodos.find((m) => m.nome === "select");
          const colunas = select ? (textoLiteral(select.args[0])?.valor ?? "*") : "*";
          const listaColunas = colunas === "*" ? [] : colunas.split(",").map((c) => c.trim()).filter((c) => /^[a-z_][a-z0-9_]*$/i.test(c));
          objetos.set(kChamada, {
            tipo: "chamada", chave: kChamada, nome: `${rel}:${linha}`, pai: kArquivo,
            atributos: {
              arquivo: rel, linha, via: "from", alvo: t?.valor ?? null, dinamica: !t, operacao: escrita ? escrita.nome : "select",
              colunas: listaColunas, limitada: metodos.some((m) => LIMITE.has(m.nome)),
            },
          });
          anotarArquivo(rel).chamadas++;
          if (t) {
            const ev = { arquivo: rel, linha, trecho: call.getText().slice(0, 200) };
            relacoes.push({ origem: kChamada, destino: chave.tabela("public", t.valor), tipo: escrita ? "escreve" : "le", evidencia: ev, certeza: t.certeza });
            for (const c of listaColunas) relacoes.push({ origem: kChamada, destino: chave.coluna("public", t.valor, c), tipo: "le", evidencia: ev, certeza: t.certeza });
          } else {
            avisos.push(`${rel}:${linha} usa .from() com nome dinâmico`);
          }
        } else if (Node.isPropertyAccessExpression(expr) && expr.getName() === "rpc") {
          const f = textoLiteral(args[0]);
          const obj = args[1];
          const argumentos = obj && Node.isObjectLiteralExpression(obj)
            ? obj.getProperties().map((p) => (Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p) ? p.getName() : null)).filter(Boolean) as string[]
            : [];
          objetos.set(kChamada, {
            tipo: "chamada", chave: kChamada, nome: `${rel}:${linha}`, pai: kArquivo,
            atributos: { arquivo: rel, linha, via: "rpc", alvo: f?.valor ?? null, dinamica: !f, argumentos: argumentos.sort() },
          });
          anotarArquivo(rel).chamadas++;
          if (f) {
            relacoes.push({
              origem: kChamada, destino: chave.funcaoPorNome("public", f.valor), tipo: "chama",
              evidencia: { arquivo: rel, linha, trecho: call.getText().slice(0, 200), argumentos }, certeza: f.certeza,
            });
          }
        } else if (Node.isIdentifier(expr) && expr.getText() === "fetch") {
          const a0 = args[0];
          const url = a0 ? a0.getText().replace(/^[`'"]|[`'"]$/g, "") : "";
          const m = /\/(rest|functions)\/v1\/(rpc\/)?([A-Za-z0-9_]+)/.exec(url);
          if (!m) continue;
          const [, area, rpc, nome] = m;
          objetos.set(kChamada, {
            tipo: "chamada", chave: kChamada, nome: `${rel}:${linha}`, pai: kArquivo,
            atributos: { arquivo: rel, linha, via: "fetch", alvo: url.slice(0, 200) },
          });
          anotarArquivo(rel).chamadas++;
          const destino = area === "functions" ? chave.edge(nome) : rpc ? chave.funcaoPorNome("public", nome) : chave.tabela("public", nome);
          relacoes.push({ origem: kChamada, destino, tipo: area === "functions" || rpc ? "chama" : "le", evidencia: { arquivo: rel, linha, trecho: url }, certeza: "inferida" });
        }
      }
    }

    for (const [rel, uso] of usoPorArquivo) {
      objetos.set(chave.arquivo(rel), {
        tipo: "arquivo", chave: chave.arquivo(rel), nome: rel, pai: null,
        atributos: { chamadas: uso.chamadas, envs: [...uso.envs].sort() },
      });
      for (const nome of [...uso.envs].sort()) {
        relacoes.push({ origem: chave.arquivo(rel), destino: chave.env(nome), tipo: "usa_env", evidencia: { arquivo: rel }, certeza: "exata" });
      }
    }
    for (const [nome, arquivos] of envs) {
      objetos.set(chave.env(nome), {
        tipo: "env", chave: chave.env(nome), nome, pai: null,
        atributos: { publica: nome.startsWith("NEXT_PUBLIC_"), parece_segredo: SEGREDO.test(nome) && !/ANON|PUBLISHABLE/i.test(nome), arquivos: [...arquivos].sort() },
      });
    }

    return { objetos: [...objetos.values()], relacoes, observacoes: [], modo: "arquivos", avisos };
  },
};

#!/usr/bin/env node
// CLI do motor. O código é TypeScript rodando direto no Node 24 (type stripping), sem build.
// O aviso de recurso experimental vai embora para não poluir a saída dos hooks.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.error(w);
});

// Cache de compilação do Node (inclui o TypeScript já sem tipos): o gate roda a cada migration do agente.
const { enableCompileCache } = await import("node:module");
enableCompileCache?.();

/** Falha de conexão do Node chega como AggregateError (um erro por endereço tentado) e sem texto próprio. */
function mensagemDe(erro) {
  if (!(erro instanceof Error)) return String(erro);
  const internos = erro instanceof AggregateError ? erro.errors.filter((e) => e instanceof Error) : [];
  return erro.message || internos.map((e) => e.message).find(Boolean) || erro.code || erro.name;
}

const { main } = await import("../src/cli.ts");
try {
  process.exitCode = (await main(process.argv.slice(2))) ?? 0;
} catch (erro) {
  console.error(`meraki: ${mensagemDe(erro)}`);
  if (process.env.MERAKI_DEBUG) console.error(erro);
  process.exitCode = 1;
}

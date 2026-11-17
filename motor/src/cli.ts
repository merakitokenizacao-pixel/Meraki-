/**
 * meraki — o motor de estrutura. Cada comando é importado só quando chamado:
 * o gate não pode pagar o custo de carregar coletor, ts-morph ou pool de conexões.
 */
import { fecharPlataforma } from "./plataforma/db.ts";
import { type Argumentos, lerArgumentos } from "./util/args.ts";
import { VERSAO_MOTOR } from "./util/raiz.ts";

const AJUDA = `meraki ${VERSAO_MOTOR} — motor de estrutura

Coleta e verificação
  meraki coletar --projeto <slug> | --todos     coleta as fontes, grava o diff, roda as regras e as métricas
  meraki checar --projeto <slug> [--json]       roda as regras no último estado, sem gravar nada
  meraki regras                                 catálogo de regras (as que barram no gate marcadas)

Contrato
  meraki contrato rascunho --projeto <slug> [--saida arquivo.yaml]
  meraki contrato publicar --projeto <slug> --arquivo contrato.yaml --motivo "..."
  meraki contrato mostrar  --projeto <slug>
  meraki propor --projeto <slug> --tipo <tipo> --sql migration.sql --justificativa "..." [--papel x] [--primitiva y]

Agentes de IA
  meraki avaliar --projeto <slug> | --todos [--pedir [--agente <nome>]]
                                                roda as rodadas de avaliação pedidas (--pedir: da versão atual)
  meraki producao --projeto <slug> | --todos [--dias 30]
                                                produção por versão e dia (agregados no banco do cliente)
  meraki conversa --projeto <slug> --agente <chave> --mensagem <id>
                                                conversa ao vivo, anonimizada; nada é gravado
  meraki servir [--host 127.0.0.1] [--porta 7341]
                                                motor por HTTP: hook do n8n, conversa da tela e rodadas

Hooks do Claude Code (.claude/settings.json)
  meraki contexto --projeto <slug>              SessionStart: baixa o estado e imprime o resumo para o agente
  meraki gate --projeto <slug> --modo autonomo|pergunta
                                                PreToolUse em apply_migration/execute_sql
  meraki gate-arquivos --protegido .meraki/     PreToolUse em Edit|Write: nega escrita em .meraki/
  meraki gate-publicacao [--projeto <slug>]     PreToolUse nas tools do MCP do n8n que publicam (plano B)
  meraki gate-rascunho [--projeto <slug>]       PostToolUse nas tools que salvam workflow: avisa os achados

Desenvolvimento
  meraki dev preparar [--reset]                 plataforma + bancos de exemplo no cluster local
  meraki dev simular                            uso simulado dos consumidores
  meraki tipos [--saida arquivo.ts]             tipos TypeScript das tabelas da plataforma para a web
`;

type Comando = (args: Argumentos) => Promise<void>;

const COMANDOS: Record<string, () => Promise<Comando>> = {
  coletar: async () => (await import("./comandos/coletar.ts")).coletar,
  checar: async () => (await import("./comandos/coletar.ts")).checar,
  regras: async () => (await import("./comandos/regras.ts")).regras,
  tipos: async () => (await import("./comandos/regras.ts")).tipos,
  contrato: async () => (await import("./comandos/contrato.ts")).contrato,
  propor: async () => (await import("./comandos/propor.ts")).propor,
  contexto: async () => (await import("./comandos/contexto.ts")).contexto,
  gate: async () => (await import("./comandos/gate.ts")).gate,
  "gate-arquivos": async () => (await import("./comandos/gate.ts")).gateArquivos,
  "gate-publicacao": async () => (await import("./comandos/agentes.ts")).gatePublicacao,
  "gate-rascunho": async () => (await import("./comandos/agentes.ts")).gateRascunho,
  avaliar: async () => (await import("./comandos/agentes.ts")).avaliar,
  producao: async () => (await import("./comandos/agentes.ts")).producao,
  conversa: async () => (await import("./comandos/agentes.ts")).conversa,
  servir: async () => (await import("./comandos/agentes.ts")).servir,
  dev: async () => (await import("./comandos/dev.ts")).dev,
};

/** Hooks precisam falhar fechado: erro vira "perguntar", nunca "permitir" por omissão. */
const HOOKS = new Set(["gate", "gate-arquivos", "gate-publicacao"]);

export async function main(argv: string[]): Promise<void> {
  const args = lerArgumentos(argv);
  const nome = args.posicionais[0];
  if (!nome || nome === "ajuda" || nome === "help" || args.opcoes.help || args.opcoes.ajuda) {
    process.stdout.write(AJUDA);
    return;
  }
  if (nome === "versao" || args.opcoes.version) {
    process.stdout.write(`${VERSAO_MOTOR}\n`);
    return;
  }
  const carregar = COMANDOS[nome];
  if (!carregar) throw new Error(`comando desconhecido: ${nome} (veja meraki ajuda)`);
  try {
    await (await carregar())(args);
  } catch (e) {
    if (!HOOKS.has(nome)) throw e;
    const motivo = `Meraki: o gate falhou (${e instanceof Error ? e.message : String(e)}). Confirme com uma pessoa antes de seguir.`;
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: motivo } }),
    );
  } finally {
    await fecharPlataforma();
  }
}

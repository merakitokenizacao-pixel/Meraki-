/**
 * Gate de publicação do Meraki no n8n (hooks externos de backend). CommonJS (.cjs): o n8n carrega com require.
 * Carregue no n8n com:
 *   EXTERNAL_HOOK_FILES=/caminho/meraki-hooks.cjs
 *   MERAKI_MOTOR_URL=http://meraki-motor:7341      (rede interna, sem porta pública)
 *   MERAKI_SERVICO_TOKEN=<o mesmo token do meraki servir>
 *   MERAKI_GATE_PRAZO_MS=4000                      (opcional)
 *   MERAKI_GATE_EMERGENCIA=1                       (só em emergência: libera se o motor não responder)
 *
 * No n8n 2.x, workflow.activate roda a cada publicação (editor, API ou MCP, inclusive versão do histórico e
 * republicação só de configurações), antes de trocar a versão no ar: lançar erro cancela, a versão anterior segue
 * no ar e a mensagem volta para quem tentou. O candidato traz a versão que vai ao ar em activeVersion (e nos
 * próprios nodes); o rascunho não vem. Reparo interno do n8n (publicação pelo sistema) não chama hooks: a coleta
 * registra. Workflow sem agente de IA passa direto no motor.
 * Motor fora do ar: barra (o gate da fase 1 também fecha seguro), a não ser com MERAKI_GATE_EMERGENCIA=1.
 */
"use strict";

const URL_MOTOR = (process.env.MERAKI_MOTOR_URL || "http://127.0.0.1:7341").replace(/\/+$/, "");
const TOKEN = process.env.MERAKI_SERVICO_TOKEN || "";
const PRAZO_MS = Number(process.env.MERAKI_GATE_PRAZO_MS || 4000);
const EMERGENCIA = ["1", "true", "sim"].includes(String(process.env.MERAKI_GATE_EMERGENCIA || "").toLowerCase());

function versaoQueVaiAoAr(w) {
  const base = {
    id: String(w.id),
    name: w.name,
    tags: (w.tags || []).map((t) => (typeof t === "string" ? t : t && t.name)).filter(Boolean),
    versionId: w.versionId,
    activeVersionId: w.activeVersionId,
    nodes: w.nodes || [],
    connections: w.connections || {},
  };
  if (w.activeVersion && Array.isArray(w.activeVersion.nodes)) {
    base.activeVersion = { versionId: w.activeVersion.versionId, nodes: w.activeVersion.nodes, connections: w.activeVersion.connections || {} };
  }
  return base;
}

async function perguntarAoMotor(workflow) {
  const resposta = await fetch(`${URL_MOTOR}/gate/publicacao`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify({ workflow: versaoQueVaiAoAr(workflow) }),
    signal: AbortSignal.timeout(PRAZO_MS),
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro || `HTTP ${resposta.status}`);
  return corpo;
}

module.exports = {
  workflow: {
    activate: [
      async function merakiGateDePublicacao(workflow) {
        if (!workflow || !Array.isArray(workflow.nodes)) return;
        let decisao;
        try {
          decisao = await perguntarAoMotor(workflow);
        } catch (e) {
          const motivo = e && e.message ? e.message : String(e);
          if (EMERGENCIA) {
            console.warn(`[meraki] motor sem resposta (${motivo}); publicação liberada por MERAKI_GATE_EMERGENCIA`);
            return;
          }
          throw new Error(`Meraki: não consegui verificar a publicação (${motivo}). Tente de novo em instantes; em emergência, ligue MERAKI_GATE_EMERGENCIA=1.`);
        }
        if (decisao && decisao.decisao && decisao.decisao !== "permitiu") {
          throw new Error(decisao.motivo || "Meraki: publicação barrada.");
        }
      },
    ],
  },
};

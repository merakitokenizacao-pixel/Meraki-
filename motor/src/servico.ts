/**
 * meraki servir: o motor respondendo por HTTP na rede interna (sem porta pública).
 *   GET  /saude                         vivo?
 *   POST /gate/publicacao               hook workflow.activate do n8n → { decisao, motivo }
 *   GET  /conversa?projeto&agente&mensagem   tela Conversa: busca ao vivo, anonimiza e não grava
 *   POST /rodadas                       acorda o processamento das rodadas pedidas (a tela pediu uma)
 * Fora do loopback o token (MERAKI_SERVICO_TOKEN, Authorization: Bearer) é obrigatório.
 * Rodadas pedidas são processadas a cada 30 s; depois de cada uma, a verificação do projeto roda de novo.
 */
import { timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { VersaoN8n, WorkflowN8n } from "./coletores/n8n.ts";
import { ErroDeConversa, buscarConversa } from "./agentes/conversa.ts";
import { decidirPublicacao } from "./agentes/gate.ts";
import { processarRodadas } from "./agentes/rodadas.ts";
import { carregarEnv } from "./plataforma/db.ts";
import { listarProjetos } from "./plataforma/repositorio.ts";
import { VERSAO_MOTOR } from "./util/raiz.ts";
import { verificarProjeto } from "./verificacao.ts";

const LIMITE_CORPO = 5 * 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

class ErroHttp extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let tamanho = 0;
    req.on("data", (d: Buffer) => {
      tamanho += d.length;
      if (tamanho > LIMITE_CORPO) {
        reject(new ErroHttp(413, "corpo grande demais"));
        req.destroy();
        return;
      }
      partes.push(d);
    });
    req.on("end", () => {
      const texto = Buffer.concat(partes).toString("utf8").trim();
      if (!texto) return resolve({});
      try {
        resolve(JSON.parse(texto));
      } catch {
        reject(new ErroHttp(400, "JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

function responder(res: ServerResponse, status: number, corpo: unknown) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(texto) });
  res.end(texto);
}

function autorizado(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const recebido = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1]?.trim() ?? "";
  const a = Buffer.from(recebido);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function workflowDoCorpo(corpo: Record<string, unknown>): { workflow: WorkflowN8n; versao?: VersaoN8n } {
  const w = (corpo.workflow ?? corpo) as WorkflowN8n;
  if (!w || typeof w !== "object" || !w.id || !Array.isArray(w.nodes)) throw new ErroHttp(400, "mande o workflow com id, nodes e connections");
  // n8n 2.x: o candidato do workflow.activate traz a versão que vai ao ar em activeVersion/activeVersionId, e os
  // nodes dele já são os dela (o rascunho não vem). No 1.x não há versão: vai ao ar o próprio workflow.
  const versao: VersaoN8n | undefined = w.activeVersion?.nodes
    ? { ...w.activeVersion, versionId: w.activeVersion.versionId ?? w.activeVersionId ?? undefined }
    : w.activeVersionId
      ? { versionId: w.activeVersionId, nodes: w.nodes, connections: w.connections ?? {} }
      : undefined;
  return { workflow: { ...w, id: String(w.id), name: String(w.name ?? w.id) }, versao };
}

export interface OpcoesServico {
  host: string;
  porta: number;
  intervaloRodadasMs?: number;
  log?: (s: string) => void;
}

export function iniciarServico(o: OpcoesServico): { fechar: () => Promise<void>; endereco: () => string } {
  carregarEnv();
  const token = process.env.MERAKI_SERVICO_TOKEN || undefined;
  if (!LOOPBACK.has(o.host) && !token) throw new Error("meraki servir fora do loopback precisa de MERAKI_SERVICO_TOKEN");
  const log = o.log ?? ((s: string) => process.stdout.write(`${s}\n`));

  let ocupado = false;
  let deNovo = false;
  const rodar = async () => {
    if (ocupado) {
      deNovo = true;
      return;
    }
    ocupado = true;
    try {
      do {
        deNovo = false;
        const feitas = await processarRodadas({ log });
        const projetos = new Set(feitas.map((r) => r.projetoId));
        if (projetos.size) {
          for (const p of (await listarProjetos()).filter((x) => projetos.has(x.id))) await verificarProjeto(p, { gravar: true });
        }
      } while (deNovo);
    } catch (e) {
      log(`rodadas: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      ocupado = false;
    }
  };
  const relogio = setInterval(rodar, o.intervaloRodadasMs ?? 30_000);
  relogio.unref();

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://motor");
    try {
      if (req.method === "GET" && url.pathname === "/saude") return responder(res, 200, { ok: true, versao: VERSAO_MOTOR });
      if (!autorizado(req, token)) throw new ErroHttp(401, "token inválido");

      if (req.method === "POST" && url.pathname === "/gate/publicacao") {
        const corpo = (await lerCorpo(req)) as Record<string, unknown>;
        const { workflow, versao } = workflowDoCorpo(corpo);
        const d = await decidirPublicacao({
          workflow, versao, origem: "n8n", ferramenta: "workflow.activate",
          projeto: typeof corpo.projeto === "string" ? corpo.projeto : undefined,
          sessao: typeof corpo.usuario === "string" ? corpo.usuario.slice(0, 120) : null,
        });
        log(`gate · ${workflow.name} · ${d.decisao}${d.agentes.length ? ` · ${d.agentes.map((a) => `${a.nome} v${a.hash}`).join(", ")}` : ""} · ${d.duracaoMs} ms`);
        if (d.agentes.some((a) => a.rodada)) void rodar();
        return responder(res, 200, { decisao: d.decisao, motivo: d.motivo, projeto: d.projeto, agentes: d.agentes });
      }

      if (req.method === "GET" && url.pathname === "/conversa") {
        const [projeto, agente, mensagem] = ["projeto", "agente", "mensagem"].map((k) => url.searchParams.get(k) ?? "");
        if (!projeto || !agente || !mensagem) throw new ErroHttp(400, "faltou projeto, agente ou mensagem");
        return responder(res, 200, await buscarConversa(projeto, agente, mensagem));
      }

      if (req.method === "POST" && url.pathname === "/rodadas") {
        void rodar();
        return responder(res, 202, { ok: true });
      }

      throw new ErroHttp(404, "rota desconhecida");
    } catch (e) {
      const status = e instanceof ErroHttp ? e.status : e instanceof ErroDeConversa ? e.status : 500;
      const mensagem = e instanceof Error ? e.message : String(e);
      if (status >= 500) log(`erro em ${req.method} ${url.pathname}: ${mensagem}`);
      if (!res.headersSent) responder(res, status, { erro: mensagem });
    }
  });
  servidor.requestTimeout = 60_000;
  servidor.listen(o.porta, o.host);
  void rodar();
  return {
    endereco: () => {
      const a = servidor.address();
      return typeof a === "object" && a ? `http://${a.address.includes(":") ? `[${a.address}]` : a.address}:${a.port}` : "";
    },
    fechar: () =>
      new Promise<void>((resolve) => {
        clearInterval(relogio);
        servidor.close(() => resolve());
      }),
  };
}

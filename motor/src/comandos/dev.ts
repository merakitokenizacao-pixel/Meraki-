/**
 * meraki dev preparar [--reset]: monta o ambiente local no cluster de desenvolvimento.
 *   banco da plataforma (shim do Supabase + migrations + seed), bancos de exemplo, papéis,
 *   uso simulado (pg_stat_statements por papel) e, na primeira vez, a demonstração:
 *   coleta de linha de base → contrato v1 do crm-exemplo → mudança feita direto no banco → nova coleta →
 *   agente de atendimento (fase 2): linha do tempo de publicação, casos, rodadas e o gate barrando o rascunho.
 * meraki dev simular: roda de novo só o uso simulado.
 * Recusa rodar fora de localhost: nada aqui serve para um banco de verdade.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import pg from "pg";
import { decidirPublicacao } from "../agentes/gate.ts";
import { atualizarProducao } from "../agentes/producao.ts";
import { atualizarRascunhos } from "../agentes/rascunhos.ts";
import { pedirRodada, processarRodadas } from "../agentes/rodadas.ts";
import { chave } from "../chaves.ts";
import type { WorkflowN8n } from "../coletores/n8n.ts";
import { lerContratoYaml } from "../contrato/esquema.ts";
import { fecharPlataforma, plataforma, transacao, urlPlataforma } from "../plataforma/db.ts";
import { type Projeto, gravarContrato, projetoPorSlug } from "../plataforma/repositorio.ts";
import { type Argumentos, flag } from "../util/args.ts";
import { RAIZ } from "../util/raiz.ts";
import { verificarProjeto } from "../verificacao.ts";
import { coletar } from "./coletar.ts";
import { contagem, out } from "./comum.ts";

const PLATAFORMA = join(RAIZ, "plataforma");
const EXEMPLOS = join(RAIZ, "exemplos", "projetos");
const BANCOS_DE_EXEMPLO = [
  { banco: "crm_exemplo", script: join(EXEMPLOS, "crm-exemplo", "banco.sql") },
  { banco: "agenda_exemplo", script: join(EXEMPLOS, "agenda-exemplo", "banco.sql") },
];

function urlLocal(banco: string, usuario?: string): string {
  const u = new URL(urlPlataforma());
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) {
    throw new Error(`meraki dev só roda no cluster local; MERAKI_DB_URL aponta para ${u.hostname}`);
  }
  u.pathname = `/${banco}`;
  if (usuario) {
    u.username = usuario;
    u.password = "";
  }
  return u.toString();
}

async function comCliente<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url, application_name: "meraki-dev" });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}

async function existeBanco(admin: pg.Client, nome: string): Promise<boolean> {
  return (await admin.query("select 1 from pg_database where datname = $1", [nome])).rowCount === 1;
}

async function rodarArquivo(c: pg.Client, arquivo: string): Promise<void> {
  await c.query("begin");
  try {
    await c.query(await readFile(arquivo, "utf8"));
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw new Error(`${arquivo.slice(RAIZ.length)}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function prepararPlataforma(admin: pg.Client): Promise<void> {
  if (!(await existeBanco(admin, "meraki"))) {
    await admin.query("create database meraki");
    out("  banco meraki criado");
  }
  await comCliente(urlLocal("meraki"), async (c) => {
    await rodarArquivo(c, join(PLATAFORMA, "local", "00_supabase_local.sql"));
    await c.query(`create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[])`);
    const aplicadas = new Set((await c.query("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version as string));
    for (const arquivo of (await readdir(join(PLATAFORMA, "migrations"))).filter((f) => f.endsWith(".sql")).sort()) {
      const [versao, ...resto] = arquivo.replace(/\.sql$/, "").split("_");
      if (aplicadas.has(versao)) continue;
      await rodarArquivo(c, join(PLATAFORMA, "migrations", arquivo));
      await c.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [versao, resto.join("_")]);
      out(`  migration ${arquivo}`);
    }
    await rodarArquivo(c, join(PLATAFORMA, "seed.sql"));
  });
}

async function prepararExemplos(admin: pg.Client): Promise<void> {
  await admin.query(`do $$ begin
    if not exists (select from pg_roles where rolname = 'meraki_leitor') then create role meraki_leitor login; end if;
    if not exists (select from pg_roles where rolname = 'app_painel') then create role app_painel login; end if;
    if not exists (select from pg_roles where rolname = 'app_n8n') then create role app_n8n login; end if;
  end $$`);
  // Como na vida real: o n8n e as rotinas de admin do painel usam credencial que passa por cima da RLS.
  await admin.query("alter role app_painel bypassrls; alter role app_n8n bypassrls");
  // O leitor nunca escreve na fonte, nem por engano: o mesmo de exemplos/fontes/meraki_leitor.sql.
  await admin.query("alter role meraki_leitor set default_transaction_read_only = on");
  await admin.query("alter role meraki_leitor set statement_timeout = '15s'");
  await admin.query("grant pg_read_all_stats to meraki_leitor");
  for (const { banco, script } of BANCOS_DE_EXEMPLO) {
    if (await existeBanco(admin, banco)) continue;
    await admin.query(`create database ${banco}`);
    await comCliente(urlLocal(banco), (c) => rodarArquivo(c, script));
    out(`  banco ${banco} criado`);
  }
}

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Uso de cada consumidor com o próprio papel: é daqui que sai "quem usa o quê" (pg_stat_statements). */
export async function simularUso(): Promise<void> {
  // Zera o pg_stat_statements (é do cluster todo): só o uso simulado entra nas relações papel → objeto.
  await comCliente(urlLocal("agenda_exemplo"), (c) => c.query("select public.pg_stat_statements_reset()"));
  await comCliente(urlLocal("crm_exemplo", "app_painel"), async (c) => {
    for (let i = 0; i < 20; i++) await c.query("select id, nome, etiquetas from public.contatos where tenant_id = $1 order by nome limit 50", [TENANT]);
    for (let i = 0; i < 8; i++) await c.query("select id, nome, cor from public.etiquetas where tenant_id = $1 limit 100", [TENANT]);
    for (let i = 0; i < 5; i++) await c.query("select id, canal, status, criado_em from public.envios where tenant_id = $1", [TENANT]);
    const contato = (await c.query("select id from public.contatos where tenant_id = $1 order by nome limit 1", [TENANT])).rows[0].id;
    for (let i = 0; i < 3; i++) {
      await c.query("insert into public.envios (tenant_id, contato_id, canal, conteudo) values ($1, $2, $3, $4)", [TENANT, contato, "whatsapp", "Reenvio manual"]);
    }
  });
  await comCliente(urlLocal("crm_exemplo", "app_n8n"), async (c) => {
    const etiqueta = (await c.query("select id from public.etiquetas order by nome limit 1")).rows[0].id;
    for (let i = 0; i < 6; i++) {
      await c.query(
        "select c.id, c.nome, c.email, c.etiquetas from public.contatos c join public.contato_etiquetas ce on ce.contato_id = c.id where ce.etiqueta_id = $1 and c.tenant_id = $2",
        [etiqueta, TENANT],
      );
    }
    for (let i = 0; i < 10; i++) await c.query("insert into public.execucoes (tenant_id, workflow, status) values ($1, $2, $3)", [TENANT, "Disparo de campanha", "ok"]);
    for (let i = 0; i < 2; i++) await c.query("select public.relatorio_envios($1::uuid, current_date - 7, current_date) as total", [TENANT]);
  });
  await comCliente(urlLocal("agenda_exemplo", "app_n8n"), async (c) => {
    for (let i = 0; i < 10; i++) await c.query("select a.id, a.inicio, a.cliente_id from public.proximos_agendamentos(24) a");
    const ag = (await c.query("select id from public.agendamentos order by inicio limit 5")).rows;
    for (const a of ag) await c.query("insert into public.lembretes (agendamento_id, canal) values ($1, 'sms')", [a.id]);
    for (let i = 0; i < 2; i++) await c.query("select public.agendar(1, 2, now() + interval '3 days', interval '40 minutes') as id");
  });
  out("  uso simulado: painel e n8n, cada um com o próprio papel");
}

/** Alguém cria uma função direto no banco depois da linha de base: dívida nova, não herdada. */
const MUDANCA_DIRETA = `
create function public.contatos_buscar(p_tenant uuid, p_termo text) returns setof public.contatos
language sql stable security definer
as $$ select * from public.contatos c where c.tenant_id = p_tenant and c.nome ilike '%' || p_termo || '%' $$;
grant execute on function public.contatos_buscar(uuid, text) to app_painel;
`;

async function demonstracao(): Promise<void> {
  await escreverExecucoes(new Date());
  out("Coleta de linha de base");
  await coletar({ posicionais: [], opcoes: { todos: true } });
  const crm = await projetoPorSlug("crm-exemplo");
  const conteudo = lerContratoYaml(await readFile(join(EXEMPLOS, "crm-exemplo", "contrato.yaml"), "utf8"));
  const versao = await gravarContrato(crm, conteudo, "Ana Ribeiro", "Contrato v1: primitivas etiqueta e mensagem_saida, consumidores e convenção de tenant");
  const v = await verificarProjeto(crm, { gravar: true });
  out(`Contrato v${versao} do crm-exemplo publicado · saúde ${v.saude} · ${contagem(v.abertos)}`);
  await comCliente(urlLocal("crm_exemplo"), (c) => c.query(MUDANCA_DIRETA));
  out("Mudança direta no crm_exemplo: public.contatos_buscar criada fora de migration");
  await comCliente(urlLocal("crm_exemplo", "app_painel"), async (c) => {
    for (let i = 0; i < 4; i++) await c.query("select * from public.contatos_buscar($1, $2)", [TENANT, "Contato 1"]);
  });
  out("Segunda coleta");
  await coletar({ posicionais: [], opcoes: { todos: true } });
  await agenteSimulado();
  await agenteDeAtendimento(crm);
}

/* ─────────────── Fase 2: o agente de atendimento do crm-exemplo ─────────────── */

const DIA = 86_400_000;
const HORA = 3_600_000;
const ANA = "00000000-0000-4000-8000-0000000000a1";
const EXECUCOES = join(RAIZ, ".dev", "n8n", "crm-exemplo-execucoes.json");
/** Versão do atendimento que ficou no ar até 12 dias atrás (antes da coleta que viu a atual). */
const VERSAO_ANTERIOR = "7c41e09ab25d";

/** Gerador determinístico (mulberry32): a demonstração dá os mesmos números a cada preparo. */
function aleatorio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Execuções do n8n dos dois agentes nos últimos 30 dias, só status e horários (o mesmo que a API devolve com
 * includeData=false). A versão atual do atendimento é mais lenta: p95 acima da meta de 8 s (P4).
 */
async function escreverExecucoes(agora: Date): Promise<void> {
  const sorte = aleatorio(20261117);
  const hoje = new Date(agora);
  hoje.setHours(0, 0, 0, 0);
  const trocaDeVersao = agora.getTime() - 12 * DIA;
  const lista: { workflowId: string; status: string; startedAt: string; stoppedAt: string }[] = [];
  for (let d = 29; d >= 0; d--) {
    for (const [workflowId, porDia] of [["crm-04", 14], ["crm-05", 5]] as const) {
      for (let i = 0; i < porDia; i++) {
        const inicio = hoje.getTime() - d * DIA + (8 + sorte() * 10) * HORA;
        const lenta = sorte() < 0.12;
        const variacao = sorte();
        const falhou = workflowId === "crm-04" && sorte() < 0.02;
        if (inicio > agora.getTime() - 60_000) continue;
        const duracao =
          workflowId === "crm-05" ? 1500 + variacao * 1500 : inicio >= trocaDeVersao ? (lenta ? 8500 + variacao * 4000 : 3000 + variacao * 4500) : 2500 + variacao * 3500;
        lista.push({ workflowId, status: falhou ? "error" : "success", startedAt: new Date(inicio).toISOString(), stoppedAt: new Date(inicio + Math.round(duracao)).toISOString() });
      }
    }
  }
  lista.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  await mkdir(dirname(EXECUCOES), { recursive: true });
  await writeFile(EXECUCOES, `${JSON.stringify(lista, null, 1)}\n`, "utf8");
}

interface CasoDoArquivo {
  id: string;
  criticidade: string;
  origem: string;
  entrada: unknown;
  espera: unknown;
  rubrica?: string;
}

/** Casos salvos como a tela salva: pela função da plataforma, como a Ana (RLS e checagem de dado pessoal valem). */
async function salvarCasosComoAna(projeto: Projeto, agente: string, casos: CasoDoArquivo[], motivo: string): Promise<void> {
  await transacao(async (c) => {
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ANA, role: "authenticated" })]);
    for (const caso of casos) {
      await c.query("select public.salvar_caso($1, $2, $3, $4::jsonb, $5)", [
        projeto.id, agente, caso.id,
        JSON.stringify({ criticidade: caso.criticidade, origem: caso.origem, entrada: caso.entrada, espera: caso.espera, rubrica: caso.rubrica ?? null }),
        motivo,
      ]);
    }
  });
}

/**
 * O agente de atendimento com história: 30 dias de produção em duas versões, 32 casos de referência, a versão no
 * ar aprovada e um rascunho ("confirme na hora") que o gate barra duas vezes: sem rodada e depois com caso
 * crítico falhando. A qualificação de leads tem um caso parado há 40 dias e foi publicada sem rodada.
 */
async function agenteDeAtendimento(crm: Projeto): Promise<void> {
  const atendimento = chave.agente("crm-04", "Atendente");
  const qualificacao = chave.agente("crm-05", "Qualificador");
  const agora = new Date();
  const agentes = (
    await plataforma().query(
      `select o.chave, o.atributos ->> 'versao' as versao, o.atributos ->> 'version_id' as version_id
         from public.objetos o join public.fontes f on f.id = o.fonte_id
        where f.projeto_id = $1 and o.tipo = 'agente' and o.removido_em is null`,
      [crm.id],
    )
  ).rows as { chave: string; versao: string | null; version_id: string | null }[];
  const publicada = agentes.find((a) => a.chave === atendimento)?.versao;
  const qualificador = agentes.find((a) => a.chave === qualificacao);
  if (!publicada || !qualificador?.versao) throw new Error("a coleta não viu os agentes do crm-exemplo (crm-04 e crm-05)");

  // Linha do tempo: a versão anterior entrou pelo gate (hora exata); a atual entrou sem passar por ele e só a
  // coleta viu, 12 dias atrás — as 4 h entre a coleta anterior e essa ficam como versão incerta.
  await transacao(async (c) => {
    await c.query("delete from public.agente_publicacoes where projeto_id = $1", [crm.id]);
    const inserir = (agente: string, hash: string, versionId: string | null, inicio: number, fim: number | null, inicioMinimo: number | null, origem: string) =>
      c.query(
        `insert into public.agente_publicacoes (conta_id, projeto_id, agente, hash, version_id, inicio, fim, inicio_minimo, origem_hora)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [crm.conta_id, crm.id, agente, hash, versionId, new Date(inicio), fim === null ? null : new Date(fim), inicioMinimo === null ? null : new Date(inicioMinimo), origem],
      );
    const troca = agora.getTime() - 12 * DIA;
    await inserir(atendimento, VERSAO_ANTERIOR, "b1f0c7a2-0004-4000-8000-0000000000a0", agora.getTime() - 30 * DIA, troca, null, "hook");
    await inserir(atendimento, publicada, agentes.find((a) => a.chave === atendimento)?.version_id ?? null, troca, null, troca - 4 * HORA, "coleta");
    await inserir(qualificacao, qualificador.versao!, qualificador.version_id, agora.getTime() - 30 * DIA, null, null, "coleta");
  });
  out("Agentes: linha do tempo de publicação (versão anterior do atendimento até 12 dias atrás)");

  const arquivo = JSON.parse(await readFile(join(EXEMPLOS, "crm-exemplo", "ensaio", "casos.json"), "utf8")) as Record<string, CasoDoArquivo[]>;
  await salvarCasosComoAna(crm, atendimento, arquivo.atendimento ?? [], "Casos iniciais do atendimento");
  await salvarCasosComoAna(crm, qualificacao, arquivo.qualificacao ?? [], "Caso inicial da qualificação");
  // O caso da qualificação foi escrito há 40 dias e nunca rodou (AV4).
  await plataforma().query("update public.casos set criado_em = now() - interval '40 days', atualizado_em = now() - interval '40 days' where projeto_id = $1 and agente = $2", [crm.id, qualificacao]);
  out(`Casos de referência: ${(arquivo.atendimento ?? []).length} do atendimento, ${(arquivo.qualificacao ?? []).length} da qualificação`);

  await pedirRodada(crm, atendimento, publicada, "manual", "Ana Ribeiro");
  await processarRodadas({ projetoId: crm.id, log: out });

  const crm04 = JSON.parse(await readFile(join(EXEMPLOS, "crm-exemplo", "n8n", "crm-04-atendimento-ia.json"), "utf8")) as WorkflowN8n;
  const publicar = () => decidirPublicacao({ workflow: crm04, origem: "n8n", ferramenta: "workflow.activate", sessao: "Ana Ribeiro" }, new Date());
  const primeira = await publicar();
  out(`Gate de publicação do rascunho: ${primeira.decisao} (${[...new Set(primeira.agentes.flatMap((a) => a.regras))].join(", ")})`);
  await processarRodadas({ projetoId: crm.id, log: out });
  const segunda = await publicar();
  out(`Gate de novo, com a rodada pronta: ${segunda.decisao} (${[...new Set(segunda.agentes.flatMap((a) => a.regras))].join(", ")})`);

  for (const a of await atualizarProducao(crm)) out(`  produção · ${a.nome}: ${a.conversas} conversas · ${a.violacoes} violações · ${a.execucoes} execuções (${a.dias} dia(s))`);
  const v = await verificarProjeto(crm, { gravar: true });
  const r = await atualizarRascunhos(crm);
  out(`Agentes prontos · saúde ${v.saude} · ${contagem(v.abertos)} · rascunho divergente em ${r.agentes} agente(s)`);
}

const MARCADORES = `create table public.marcadores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  nome text not null,
  cor text,
  contato_id uuid references public.contatos (id)
);
alter table public.marcadores enable row level security;`;

/**
 * Uma sessão de agente como o hook faria: um índice passa, a tabela que repete a primitiva etiqueta é barrada,
 * o agente propõe e para. A proposta fica aberta na tela Contrato.
 */
async function agenteSimulado(): Promise<void> {
  const { baixarCache } = await import("../gate/cache.ts");
  const { avaliarMudanca } = await import("../gate/decidir.ts");
  const { registrarEventos } = await import("../gate/hook.ts");
  const { carregarParser, lerComandos } = await import("../sql/parser.ts");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  await carregarParser();
  const cache = await baixarCache("crm-exemplo", 10_000);
  const pasta = await mkdtemp(join(tmpdir(), "meraki-demo-"));
  const eventos = [];
  for (const sql of ["create index envios_tenant_idx on public.envios (tenant_id);", MARCADORES]) {
    const t0 = performance.now();
    const d = avaliarMudanca(cache, lerComandos(sql), "autonomo");
    const duracao = Math.round(performance.now() - t0);
    eventos.push({
      projeto_slug: "crm-exemplo", criado_em: new Date().toISOString(), origem: "claude-code", sessao: "demo", ferramenta: "mcp__supabase__apply_migration",
      modo: "autonomo", resumo: (d.resumo.join("; ") || sql).slice(0, 500), decisao: d.decisao, regras: [...new Set(d.violacoes.map((v) => v.regra))],
      motivo: d.motivo ?? null, proposta_id: null, duracao_ms: duracao,
    });
    if (d.decisao === "negou") {
      await plataforma().query(
        `insert into public.propostas (conta_id, projeto_id, origem, sessao, tipo, payload, justificativa) values ($1, $2, 'agente', 'demo', 'nova_tabela', $3, $4)`,
        [cache.projeto.conta_id, cache.projeto.id, JSON.stringify({ sql, objetos: d.afetados, declaracao: {}, regras: eventos.at(-1)!.regras, resumo: d.resumo }),
          "Marcadores livres por contato para a tela de segmentação"],
      );
    }
  }
  await registrarEventos(pasta, eventos as Parameters<typeof registrarEventos>[1], 5_000);
  await verificarProjeto(await projetoPorSlug("crm-exemplo"), { gravar: true }); // métricas do dia com as decisões do gate
  out("Sessão de agente simulada: 1 mudança permitida, 1 barrada pelo gate (E01, E04) e proposta aberta");
}

export async function dev(args: Argumentos): Promise<void> {
  const sub = args.posicionais[1];
  if (sub === "simular") {
    await simularUso();
    return;
  }
  if (sub !== "preparar") throw new Error("use: meraki dev preparar [--reset] | meraki dev simular");

  const reset = flag(args, "reset");
  await comCliente(urlLocal("postgres"), async (admin) => {
    if (reset) {
      await fecharPlataforma();
      for (const b of ["meraki", ...BANCOS_DE_EXEMPLO.map((x) => x.banco)]) await admin.query(`drop database if exists ${b} with (force)`);
      out("bancos locais apagados");
    }
    out("Plataforma");
    await prepararPlataforma(admin);
    out("Bancos de exemplo");
    await prepararExemplos(admin);
  });
  const jaTemColeta = (await plataforma().query("select exists (select 1 from public.coletas) as sim")).rows[0].sim as boolean;
  await simularUso();
  if (!jaTemColeta) await demonstracao();
  else out("Já existem coletas: demonstração pulada (use --reset para refazer do zero)");
  out("");
  out("Pronto. Próximos passos:");
  out("  meraki checar --projeto crm-exemplo");
  out("  cd web && npm run dev   →   http://localhost:3000");
}

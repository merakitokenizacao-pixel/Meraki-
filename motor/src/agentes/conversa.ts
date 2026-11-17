/**
 * Revisar uma conversa: busca ao vivo no banco do cliente pelo leitor do projeto, anonimiza e devolve.
 * Nada é gravado — nem na plataforma, nem em log. O contato vira "contato" (sem id) na resposta.
 */
import { carregarGrafo, contratoAtual, iso, projetoPorSlug } from "../plataforma/repositorio.ts";
import { plataforma } from "../plataforma/db.ts";
import { anonimizar } from "./anonimizar.ts";
import { agenteNoContrato, comLeitor, fonteDaTabela, ident, tabelaSql, temColuna } from "./comum.ts";

export interface MensagemDaConversa {
  id: string;
  /** "agente" para resposta do agente; o valor da coluna de autor para o resto (cliente, humano...). */
  autor: string;
  texto: string;
  momento: string;
  /** A mensagem que abriu a revisão (violação, por exemplo). */
  destaque: boolean;
}

export interface ConversaAoVivo {
  agente: string;
  nome: string;
  /** Versão publicada quando a mensagem foi enviada (null antes da primeira coleta). */
  versao: string | null;
  incerta: boolean;
  mensagens: MensagemDaConversa[];
  /** Quantos trechos foram trocados pela anonimização. */
  anonimizados: number;
}

export class ErroDeConversa extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Conversa em volta de uma mensagem: as do mesmo contato nas 12 h antes e depois, até 200. */
export async function buscarConversa(slug: string, agente: string, mensagemId: string, opcoes: { horas?: number } = {}): Promise<ConversaAoVivo> {
  const projeto = await projetoPorSlug(slug);
  const contrato = (await contratoAtual(projeto.id))?.conteudo;
  const declarado = agenteNoContrato(contrato, agente);
  if (!declarado) throw new ErroDeConversa("agente não declarado no contrato", 404);
  const m = declarado.config.conversas;
  if (!m) throw new ErroDeConversa("o contrato não mapeia as conversas deste agente", 422);
  const grafo = await carregarGrafo(projeto.id);
  const fonte = await fonteDaTabela(projeto.id, grafo, m.tabela);
  const escopo = declarado.config.escopo && temColuna(grafo, m.tabela, declarado.config.escopo.coluna) ? declarado.config.escopo : undefined;
  const filtroEscopo = (n: number) => (escopo ? ` and m.${ident(escopo.coluna)}::text = $${n}::text` : "");
  const valorEscopo = escopo ? [String(escopo.valor)] : [];
  const horas = Math.min(Math.max(opcoes.horas ?? 12, 1), 72);

  const linhas = await comLeitor(fonte, async (c) => {
    const alvo = (
      await c.query(
        `select m.${ident(m.contato)}::text as contato, m.${ident(m.momento)} as momento from ${tabelaSql(m.tabela)} m
          where m.${ident(m.id)}::text = $1::text${filtroEscopo(2)} limit 1`,
        [mensagemId, ...valorEscopo],
      )
    ).rows[0];
    if (!alvo) return null;
    return (
      await c.query(
        `select m.${ident(m.id)}::text as id, m.${ident(m.autor.coluna)}::text as autor, coalesce(m.${ident(m.texto)}::text, '') as texto, m.${ident(m.momento)} as momento
           from ${tabelaSql(m.tabela)} m
          where m.${ident(m.contato)}::text = $1::text
            and m.${ident(m.momento)} between $2::timestamptz - make_interval(hours => $3::int) and $2::timestamptz + make_interval(hours => $3::int)${filtroEscopo(4)}
          order by m.${ident(m.momento)}, m.${ident(m.id)} limit 200`,
        [alvo.contato, alvo.momento, horas, ...valorEscopo],
      )
    ).rows;
  });
  if (!linhas) throw new ErroDeConversa("mensagem não encontrada no banco do projeto", 404);

  let anonimizados = 0;
  const agenteValor = String(m.autor.agente);
  const mensagens = linhas.map((l): MensagemDaConversa => {
    const a = anonimizar(l.texto);
    anonimizados += a.trocas;
    return { id: l.id, autor: l.autor === agenteValor ? "agente" : String(l.autor ?? "?"), texto: a.texto, momento: iso(l.momento), destaque: l.id === mensagemId };
  });

  const destaque = mensagens.find((x) => x.destaque);
  const pub = destaque
    ? (
        await plataforma().query(
          `select hash, (inicio_minimo is not null and $3::timestamptz < inicio) as incerta from public.agente_publicacoes
            where projeto_id = $1 and agente = $2 and coalesce(inicio_minimo, inicio) <= $3::timestamptz and (fim is null or fim > $3::timestamptz)
            order by inicio desc limit 1`,
          [projeto.id, agente, destaque.momento],
        )
      ).rows[0]
    : undefined;
  return { agente, nome: declarado.nome, versao: pub?.hash ?? null, incerta: Boolean(pub?.incerta), mensagens, anonimizados };
}

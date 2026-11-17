/**
 * Anonimização do texto de conversa antes de ele sair do motor (tela ao vivo ou caso de referência).
 * Tira e-mail, telefone, CPF, CNPJ, CEP, números longos e nomes ditos na conversa ("meu nome é…", "oi, Fulana").
 * A plataforma confere de novo ao salvar o caso (public.dado_pessoal): o que escapar daqui é recusado lá.
 */

const NOME = "[A-ZÀ-Ý][a-zà-ÿ'’-]+(?:\\s+(?:d[aeo]s?\\s+)?[A-ZÀ-Ý][a-zà-ÿ'’-]+){0,3}";

const PADROES: { re: RegExp; troca: string }[] = [
  { re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[A-Za-z]{2,}/gu, troca: "[e-mail]" },
  { re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, troca: "[cpf]" },
  { re: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, troca: "[cnpj]" },
  { re: /\+55[\s-]?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}/g, troca: "[telefone]" },
  { re: /\(?\b\d{2}\)?\s?9?\d{4}[-\s]\d{4}\b/g, troca: "[telefone]" },
  { re: /\b[1-9]{2}9\d{8}\b/g, troca: "[telefone]" },
  { re: /\b\d{5}-\d{3}\b/g, troca: "[cep]" },
  { re: /\b\d{9,}\b/g, troca: "[número]" },
  // Nome dito pela pessoa: "meu nome é Joana Prado", "aqui é o Carlos", "me chamo Ana".
  { re: new RegExp(`\\b((?:[Mm]eu nome [ée]|[Mm]e chamo|[Aa]qui [ée](?: [oa])?|[Ss]ou (?:o|a))\\s+)${NOME}`, "gu"), troca: "$1[nome]" },
  // Cumprimento ou agradecimento com nome: "Oi, Joana", "Obrigado Carlos".
  { re: new RegExp(`\\b((?:[Oo]i|[Oo]l[áa]|[Bb]om dia|[Bb]oa tarde|[Bb]oa noite|[Oo]brigad[oa]|[Vv]aleu|[Tt]chau),?\\s+)${NOME}`, "gu"), troca: "$1[nome]" },
];

export interface TextoAnonimizado {
  texto: string;
  trocas: number;
}

export function anonimizar(texto: string): TextoAnonimizado {
  let saida = texto;
  let trocas = 0;
  for (const { re, troca } of PADROES) {
    saida = saida.replace(re, (...m) => {
      trocas++;
      return troca.replace("$1", typeof m[1] === "string" ? m[1] : "");
    });
  }
  return { texto: saida, trocas };
}

/** Mesma checagem de public.dado_pessoal: devolve o tipo do dado aparente ou null. */
export function dadoPessoal(texto: string): string | null {
  if (/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[A-Za-z]{2,}/u.test(texto)) return "e-mail";
  if (/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(texto)) return "CPF";
  if (/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(texto)) return "CNPJ";
  if (/\+55[\s-]?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}/.test(texto) || /\(?\d{2}\)?\s?9?\d{4}[-\s]\d{4}/.test(texto) || /(^|\D)[1-9]{2}9\d{8}(\D|$)/.test(texto)) return "telefone";
  return null;
}

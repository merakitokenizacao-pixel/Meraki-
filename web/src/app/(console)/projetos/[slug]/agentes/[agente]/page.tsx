import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense, cache } from "react";
import { agenteHref } from "@/components/shell/nav";
import { AgenteView } from "@/components/views/agente";
import { ParteSkeleton } from "@/components/views/projeto-cabecalho";
import { agenteDoProjeto, projetoPorSlug } from "@/lib/plataforma/consultas";

type Params = Promise<{ slug: string; agente: string }>;

/** O id vem da URL; um "%" solto não pode virar erro 500. */
function decodificar(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Uma leitura por requisição: o título e a página usam o mesmo detalhe. */
const detalhe = cache(async (slug: string, id: string) => {
  const d = await projetoPorSlug(slug);
  if (!d) return { projeto: null, agente: null };
  return { projeto: d, agente: await agenteDoProjeto({ id: d.resumo.id, slug: d.resumo.slug, nome: d.resumo.nome }, id) };
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, agente } = await params;
  const { projeto, agente: a } = await detalhe(slug, decodificar(agente));
  if (!projeto) return { title: "Projeto" };
  return { title: `${projeto.resumo.nome} · ${a?.resumo.nome ?? decodificar(agente)}` };
}

export default function AgentePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ParteSkeleton />}>
      <Conteudo params={params} />
    </Suspense>
  );
}

async function Conteudo({ params }: { params: Params }) {
  const { slug, agente } = await params;
  const id = decodificar(agente);
  const { agente: a } = await detalhe(slug, id);
  if (!a) notFound();
  // Chegou pela chave do objeto (link do drawer de Sistemas): leva para a URL de sempre, com o nome do contrato.
  if (a.resumo.id !== id) redirect(agenteHref(slug, a.resumo.id));
  return <AgenteView d={a} />;
}

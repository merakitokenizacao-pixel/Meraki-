import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AgentesView } from "@/components/views/agentes";
import { ParteSkeleton } from "@/components/views/projeto-cabecalho";
import { agentesDoProjeto, projetoPorSlug } from "@/lib/plataforma/consultas";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const d = await projetoPorSlug((await params).slug);
  return { title: d ? `${d.resumo.nome} · Agentes` : "Projeto" };
}

export default function AgentesPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ParteSkeleton />}>
      <Conteudo params={params} />
    </Suspense>
  );
}

async function Conteudo({ params }: { params: Params }) {
  const d = await projetoPorSlug((await params).slug);
  if (!d) notFound();
  return <AgentesView slug={d.resumo.slug} d={await agentesDoProjeto(d.resumo.id)} />;
}

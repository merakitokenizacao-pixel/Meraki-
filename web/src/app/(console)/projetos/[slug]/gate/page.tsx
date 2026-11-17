import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GateView } from "@/components/views/gate";
import { ParteSkeleton } from "@/components/views/projeto-cabecalho";
import { gateDoProjeto, projetoPorSlug } from "@/lib/plataforma/consultas";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const d = await projetoPorSlug((await params).slug);
  return { title: d ? `${d.resumo.nome} · Gate` : "Projeto" };
}

export default function GatePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ParteSkeleton />}>
      <Conteudo params={params} />
    </Suspense>
  );
}

async function Conteudo({ params }: { params: Params }) {
  const d = await projetoPorSlug((await params).slug);
  if (!d) notFound();
  return <GateView slug={d.resumo.slug} d={await gateDoProjeto(d.resumo.id)} />;
}

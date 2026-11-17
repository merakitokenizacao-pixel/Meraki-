import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ContratoView } from "@/components/views/contrato";
import { ParteSkeleton } from "@/components/views/projeto-cabecalho";
import { contratoDoProjeto, projetoPorSlug } from "@/lib/plataforma/consultas";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const d = await projetoPorSlug((await params).slug);
  return { title: d ? `${d.resumo.nome} · Contrato` : "Projeto" };
}

export default function ContratoPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ParteSkeleton />}>
      <Conteudo params={params} />
    </Suspense>
  );
}

async function Conteudo({ params }: { params: Params }) {
  const d = await projetoPorSlug((await params).slug);
  if (!d) notFound();
  return <ContratoView projeto={d.resumo} d={await contratoDoProjeto(d.resumo.id)} />;
}

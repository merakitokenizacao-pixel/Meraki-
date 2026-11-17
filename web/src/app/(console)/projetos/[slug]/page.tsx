import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ParteSkeleton } from "@/components/views/projeto-cabecalho";
import { SistemasView } from "@/components/views/sistemas";
import { estruturaDoProjeto, projetoPorSlug } from "@/lib/plataforma/consultas";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const d = await projetoPorSlug((await params).slug);
  return { title: d ? `${d.resumo.nome} · Sistemas` : "Projeto" };
}

export default function SistemasPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ParteSkeleton />}>
      <Conteudo params={params} />
    </Suspense>
  );
}

async function Conteudo({ params }: { params: Params }) {
  const d = await projetoPorSlug((await params).slug);
  if (!d) notFound();
  return <SistemasView d={d} e={await estruturaDoProjeto(d.resumo.id)} />;
}

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CabecalhoProjeto, CabecalhoSkeleton } from "@/components/views/projeto-cabecalho";
import { projetoPorSlug } from "@/lib/plataforma/consultas";

type Params = Promise<{ slug: string }>;

/** Cabeçalho e abas ficam no layout; cada parte carrega o próprio conteúdo. O parâmetro é lido dentro do Suspense. */
export default function ProjetoLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  return (
    <div className="animate-enter">
      <Suspense fallback={<CabecalhoSkeleton />}>
        <Cabecalho params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function Cabecalho({ params }: { params: Params }) {
  const { slug } = await params;
  const d = await projetoPorSlug(slug);
  if (!d) notFound();
  return <CabecalhoProjeto d={d} />;
}

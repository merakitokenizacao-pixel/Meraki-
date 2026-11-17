import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { ProjetosView } from "@/components/views/projetos";
import { listarProjetos } from "@/lib/plataforma/consultas";

export const metadata: Metadata = { title: "Todos os projetos" };

export default function ProjetosPage() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  const { projetos, agora } = await listarProjetos();
  return <ProjetosView projetos={projetos} agora={agora} />;
}

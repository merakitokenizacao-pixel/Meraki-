import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { VisaoGeralView } from "@/components/views/visao-geral";
import { visaoGeral } from "@/lib/plataforma/consultas";

export const metadata: Metadata = { title: "Visão geral" };

export default function VisaoGeralPage() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  return <VisaoGeralView d={await visaoGeral()} />;
}

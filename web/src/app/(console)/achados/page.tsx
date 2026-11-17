import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { AchadosView } from "@/components/views/achados";
import { listarAchados } from "@/lib/plataforma/consultas";

export const metadata: Metadata = { title: "Achados" };

export default function AchadosPage() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  const { achados, agora } = await listarAchados();
  return <AchadosView achados={achados} agora={agora} />;
}

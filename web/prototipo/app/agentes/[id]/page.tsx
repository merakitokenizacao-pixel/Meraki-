import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { AgentDetailView } from "@/components/views/agent-detail";
import { AGENTS, agentById } from "@/lib/data/agents";

type Params = Promise<{ id: string }>;

export function generateStaticParams() {
  return AGENTS.map((a) => ({ id: a.id }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const agent = agentById(id);
  return { title: agent ? `${agent.name} · Agentes de IA` : "Agente" };
}

/** A casca da rota não depende da URL; o `params` é lido dentro do Suspense (navegação instantânea). */
export default function AgentPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <AgentDetail params={params} />
    </Suspense>
  );
}

async function AgentDetail({ params }: { params: Params }) {
  const { id } = await params;
  if (!agentById(id)) notFound();
  return <AgentDetailView id={id} />;
}

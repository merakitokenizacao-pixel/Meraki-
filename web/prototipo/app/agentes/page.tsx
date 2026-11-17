import type { Metadata } from "next";
import { AgentsView } from "@/components/views/agents";

export const metadata: Metadata = { title: "Agentes de IA" };

export default function AgentsPage() {
  return <AgentsView />;
}

import type { Metadata } from "next";
import { IncidentsView } from "@/components/views/incidents";

export const metadata: Metadata = { title: "Incidentes" };

export default function IncidentsPage() {
  return <IncidentsView />;
}

import type { Metadata } from "next";
import { InfraView } from "@/components/views/infra";

export const metadata: Metadata = { title: "Sistemas" };

export default function InfraPage() {
  return <InfraView />;
}

import type { Metadata } from "next";
import { OverviewView } from "@/components/views/overview";

export const metadata: Metadata = { title: "Visão geral" };

export default function OverviewPage() {
  return <OverviewView />;
}

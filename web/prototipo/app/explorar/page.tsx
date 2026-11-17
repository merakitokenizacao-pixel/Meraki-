import type { Metadata } from "next";
import { ExplorerView } from "@/components/views/explorer";

export const metadata: Metadata = { title: "Explorar" };

export default function ExplorerPage() {
  return <ExplorerView />;
}

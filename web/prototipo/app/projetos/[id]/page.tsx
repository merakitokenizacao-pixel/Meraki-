import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { ProjectView } from "@/components/views/project";
import { PROJECTS, projectById } from "@/lib/data/projects";

type Params = Promise<{ id: string }>;

export function generateStaticParams() {
  return PROJECTS.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const project = projectById(id);
  return { title: project ? `${project.name} · Sistemas` : "Projeto" };
}

/** Parte “Sistemas” do projeto. O parâmetro é lido dentro do Suspense (navegação instantânea). */
export default function ProjectSystemsPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Project params={params} />
    </Suspense>
  );
}

async function Project({ params }: { params: Params }) {
  const { id } = await params;
  const project = projectById(id);
  if (!project) notFound();
  return <ProjectView id={project.id} part="sistemas" />;
}

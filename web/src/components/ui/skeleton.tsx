import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[8px] bg-muted/70", className)} />;
}

/** Esqueleto de página de detalhe: cabeçalho, 4 indicadores e um cartão de conteúdo. */
export function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <div className="mb-7 flex items-center gap-4">
        <Skeleton className="size-11 rounded-[7px]" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-card border border-line bg-surface p-5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-4 h-7 w-28" />
            <Skeleton className="mt-4 h-3.5 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-9 rounded-card border border-line bg-surface p-5">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="mt-6 h-[240px] w-full" />
      </div>
    </div>
  );
}

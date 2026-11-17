import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-line bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-[18px] pb-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-line bg-subtle text-ink-2 [&_svg]:size-4">{icon}</span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-[14px] leading-5 font-medium text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Rodapé de cartão — mantém ações alinhadas na base em linhas de cartões com alturas iguais. */
export function CardFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-auto flex items-center justify-between gap-3 border-t border-line px-5 py-3", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  leading,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 items-center gap-4">
        {leading}
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          {description && <p className="mt-1 text-[13.5px] text-ink-3">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-9 first:mt-0", className)}>
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

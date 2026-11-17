import Link from "next/link";
import { FolderSearch } from "lucide-react";
import { ALL_PROJECTS_HREF } from "@/components/shell/nav";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NaoEncontrado() {
  return (
    <div className="mx-auto max-w-lg animate-enter pt-16">
      <Card className="px-8 py-9 text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-[7px] border border-line bg-subtle text-ink-3">
          <FolderSearch className="size-5" strokeWidth={1.75} />
        </div>
        <h1 className="text-[16px] font-medium text-ink">Não encontramos esta página</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">O projeto pode ter mudado de endereço ou não pertencer à sua conta.</p>
        <Link href={ALL_PROJECTS_HREF} className={buttonClass("secondary", "md", "mt-6")}>
          Ver todos os projetos
        </Link>
      </Card>
    </div>
  );
}

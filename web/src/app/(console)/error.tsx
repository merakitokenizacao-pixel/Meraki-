"use client";

import { useEffect } from "react";
import { RotateCw, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Falha ao carregar uma tela (plataforma fora do ar, consulta com erro). O shell continua de pé. */
export default function Erro({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <div className="mx-auto max-w-lg animate-enter pt-16">
      <Card className="px-8 py-9 text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-[7px] border border-line bg-subtle text-ink-3">
          <ServerCrash className="size-5" strokeWidth={1.75} />
        </div>
        <h1 className="text-[16px] font-medium text-ink">Não foi possível carregar esta tela</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
          A plataforma não respondeu. Em desenvolvimento, confira se o banco local está de pé com{" "}
          <span className="font-mono text-[12px] text-ink-2">node motor/bin/meraki.mjs dev preparar</span> e tente de novo.
        </p>
        {digest && <p className="mt-3 font-mono text-[11.5px] text-ink-4">ref. {digest}</p>}
        <Button className="mt-6" onClick={() => retry()}>
          <RotateCw />
          Tentar de novo
        </Button>
      </Card>
    </div>
  );
}

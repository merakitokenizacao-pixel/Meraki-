import { cn } from "@/lib/utils";

/** Wordmark do Meraki — só o nome, em serifada reta e branca. É a única serifa do console. */
export function Logo({ className }: { className?: string }) {
  return <span className={cn("font-brand text-[23px] leading-none tracking-[-0.025em] text-white select-none", className)}>Meraki</span>;
}

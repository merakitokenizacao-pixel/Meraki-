import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

const base =
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium transition-[background-color,color,border-color] duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-on-ink hover:bg-white",
  secondary: "border border-line-2 bg-raised text-ink hover:border-ink-4 hover:bg-muted",
  ghost: "text-ink-2 hover:bg-raised hover:text-ink",
  danger: "border border-crit/40 bg-crit-soft text-crit-ink hover:bg-crit/25",
};

const sizes: Record<Size, string> = {
  xs: "h-6 px-2 text-[11.5px] [&_svg]:size-3.5",
  sm: "h-7 px-2.5 text-[12.5px] [&_svg]:size-3.5",
  md: "h-8 px-3 text-[13px] [&_svg]:size-4",
  lg: "h-10 px-4 text-[14px] [&_svg]:size-4",
  icon: "size-8 [&_svg]:size-4",
  "icon-sm": "size-7 [&_svg]:size-3.5",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

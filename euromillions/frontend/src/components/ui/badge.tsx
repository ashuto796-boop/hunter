import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors", {
  variants: {
    variant: {
      default: "border-transparent bg-primary/20 text-violet-200",
      gold: "border-amber-400/40 bg-amber-400/10 text-amber-200",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      destructive: "border-red-500/40 bg-red-500/10 text-red-200",
      success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
      outline: "text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

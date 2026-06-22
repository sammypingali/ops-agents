import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Canonical status pill — one shape + a tinted semantic palette, used for every
// status/type/source chip across the app so the tables read as one system.
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border border-border text-muted-foreground",
        success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        danger: "bg-red-500/15 text-red-700 dark:text-red-400",
        info: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
        accent: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

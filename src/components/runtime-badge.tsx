import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AppRuntime } from "@/lib/apps/types";

const labels: Record<AppRuntime, string> = {
  next: "Next.js",
  node: "Node.js",
  bun: "Bun",
};

interface RuntimeBadgeProps {
  runtime: AppRuntime;
}

export function RuntimeBadge({ runtime }: RuntimeBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[0.68rem]",
        runtime === "next" &&
          "border-emerald-400/20 bg-emerald-400/8 text-emerald-300",
        runtime === "node" &&
          "border-lime-400/20 bg-lime-400/8 text-lime-300",
        runtime === "bun" &&
          "border-amber-300/20 bg-amber-300/8 text-amber-200",
      )}
    >
      {labels[runtime]}
    </Badge>
  );
}

import { Badge } from "@/components/ui/badge";
import type { AppPortInfo } from "@/lib/apps/types";
import { cn } from "@/lib/utils";

const roleStyles: Record<AppPortInfo["kind"], string> = {
  "primary-web": "border-emerald-400/25 bg-emerald-400/8 text-emerald-300",
  web: "border-sky-400/25 bg-sky-400/8 text-sky-300",
  "mail-web": "border-violet-400/25 bg-violet-400/8 text-violet-300",
  smtp: "border-amber-400/25 bg-amber-400/8 text-amber-300",
  internal: "border-border/80 bg-muted/40 text-muted-foreground",
  service: "border-border/80 bg-muted/40 text-muted-foreground",
};

export function PortRoleBadge({ portInfo }: { portInfo: AppPortInfo }) {
  return (
    <Badge
      variant="outline"
      className={cn("shrink-0 text-[0.65rem]", roleStyles[portInfo.kind])}
      title={portInfo.description}
    >
      {portInfo.label}
    </Badge>
  );
}

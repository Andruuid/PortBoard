import { RefreshCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AppSupervision } from "@/lib/apps/types";

export function SupervisionBadge({
  supervision,
}: {
  supervision: AppSupervision;
}) {
  if (supervision.kind !== "supervised") {
    return null;
  }

  return (
    <Badge
      variant="outline"
      className="border-amber-400/25 bg-amber-400/8 text-[0.65rem] text-amber-300"
      title="This process is managed and may restart unless its supervisor is stopped."
    >
      <RefreshCcw data-icon="inline-start" />
      Managed by {supervision.supervisorName}
    </Badge>
  );
}

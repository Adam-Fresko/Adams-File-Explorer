import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";

import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { useExplorerStore } from "../store/useExplorerStore";

export function StatusBar() {
  const statusText = useExplorerStore((state) => state.statusText);
  const errorText = useExplorerStore((state) => state.errorText);

  return (
    <footer className="flex shrink-0 items-center gap-2 border-t bg-background px-3 py-2 text-sm">
      <Badge variant={errorText ? "destructive" : "secondary"}>
        {errorText ? (
          <CircleAlertIcon data-icon="inline-start" aria-hidden="true" />
        ) : (
          <CircleCheckIcon data-icon="inline-start" aria-hidden="true" />
        )}
        {errorText ? "Error" : "Ready"}
      </Badge>
      <Separator orientation="vertical" className="h-5" />
      <p className="m-0 min-w-0 truncate font-medium">{statusText}</p>
      {errorText ? (
        <>
          <Separator orientation="vertical" className="h-5" />
          <p className="m-0 min-w-0 truncate text-destructive">{errorText}</p>
        </>
      ) : null}
    </footer>
  );
}

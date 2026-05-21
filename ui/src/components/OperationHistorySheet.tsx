import { HistoryIcon, Redo2Icon, Undo2Icon } from "lucide-react";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "./ui/sheet";
import { logUiEvent } from "../lib/eventLog";
import type { FileOperationTimelineEntryDto } from "../lib/types";
import { useExplorerStore } from "../store/useExplorerStore";

const operationTime = (createdUnixMs: number): string =>
  Number.isFinite(createdUnixMs)
    ? new Date(createdUnixMs).toLocaleString()
    : "";

function timelinePath(item: FileOperationTimelineEntryDto): string {
  return item.path ?? item.target_dir ?? "";
}

function TimelineList({ items }: { items: FileOperationTimelineEntryDto[] }) {
  const newestFirst = [...items].reverse();

  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Recent file actions</h3>
        <Badge variant="secondary">{items.length}</Badge>
      </div>

      {newestFirst.length ? (
        <div className="grid gap-2">
          {newestFirst.map((item) => (
            <div
              key={item.id}
              className="grid cursor-default gap-1 rounded-lg border bg-background p-3"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p className="m-0 min-w-0 truncate text-sm font-medium">{item.label}</p>
                {item.item_count > 1 ? (
                  <Badge variant="outline">{item.item_count}</Badge>
                ) : null}
              </div>
              <p className="m-0 truncate text-xs text-muted-foreground">
                {timelinePath(item)}
              </p>
              <p className="m-0 text-xs text-muted-foreground">
                {operationTime(item.created_unix_ms)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          No items
        </p>
      )}
    </section>
  );
}

export function OperationHistorySheet() {
  const open = useExplorerStore((state) => state.isHistoryPanelOpen);
  const history = useExplorerStore((state) => state.fileOperationHistory);
  const isUndoRedoRunning = useExplorerStore((state) => state.isUndoRedoRunning);
  const setHistoryPanelOpen = useExplorerStore((state) => state.setHistoryPanelOpen);
  const undoFileOperation = useExplorerStore((state) => state.undoFileOperation);
  const redoFileOperation = useExplorerStore((state) => state.redoFileOperation);
  const canUndo = history.can_undo && !isUndoRedoRunning;
  const canRedo = history.can_redo && !isUndoRedoRunning;

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        logUiEvent({
          component: "OperationHistorySheet",
          event_type: "history_panel_toggle",
          details: { open: nextOpen }
        });
        setHistoryPanelOpen(nextOpen);
      }}
    >
      <SheetContent className="w-[min(420px,calc(100vw-24px))] sm:max-w-[420px]">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <HistoryIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <SheetTitle>History</SheetTitle>
          </div>
          <SheetDescription>Recent file actions.</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-4">
          <div className="grid gap-5 pb-4">
            <TimelineList items={history.timeline} />
          </div>
        </ScrollArea>

        <SheetFooter className="border-t">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!canUndo}
              onClick={() => {
                logUiEvent({
                  component: "OperationHistorySheet",
                  event_type: "history_undo_clicked"
                });
                void undoFileOperation();
              }}
              className="flex-1"
            >
              <Undo2Icon />
              Undo
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canRedo}
              onClick={() => {
                logUiEvent({
                  component: "OperationHistorySheet",
                  event_type: "history_redo_clicked"
                });
                void redoFileOperation();
              }}
              className="flex-1"
            >
              <Redo2Icon />
              Redo
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

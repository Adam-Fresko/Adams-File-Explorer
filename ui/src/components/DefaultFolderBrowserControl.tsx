import { useRef, useState } from "react";
import { BadgeCheckIcon } from "lucide-react";

import { Switch } from "./ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { logUiEvent } from "../lib/eventLog";
import { useExplorerStore } from "../store/useExplorerStore";

export function DefaultFolderBrowserControl() {
  const isChangingRef = useRef(false);
  const [isChanging, setIsChanging] = useState(false);
  const status = useExplorerStore((state) => state.defaultFolderBrowserStatus);
  const setDefaultFolderBrowser = useExplorerStore((state) => state.setDefaultFolderBrowser);
  const resetDefaultFolderBrowser = useExplorerStore((state) => state.resetDefaultFolderBrowser);

  const isDefault = status?.is_default ?? false;
  const canSet = status?.can_set ?? false;
  const message = status?.message ?? "Checking default folder browser";
  const disabled = !status || (!canSet && !isDefault) || isChanging;
  const tooltipText = isDefault ? "This app opens folders by default" : message;

  const onCheckedChange = async (checked: boolean) => {
    if (isChangingRef.current || disabled || checked === isDefault) {
      return;
    }

    isChangingRef.current = true;
    setIsChanging(true);
    logUiEvent({
      component: "DefaultFolderBrowserControl",
      event_type: "default_folder_browser_toggle",
      details: { checked }
    });
    try {
      if (checked) {
        await setDefaultFolderBrowser();
      } else {
        await resetDefaultFolderBrowser();
      }
    } finally {
      isChangingRef.current = false;
      setIsChanging(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex h-9 items-center gap-2 rounded-lg border bg-muted/35 px-2.5"
          title={tooltipText}
        >
          <BadgeCheckIcon
            className={isDefault ? "size-4 text-primary" : "size-4 text-muted-foreground"}
            aria-hidden="true"
          />
          <label htmlFor="default-folder-browser" className="text-sm font-medium">
            Default folder browser
          </label>
          <Switch
            id="default-folder-browser"
            checked={isDefault}
            disabled={disabled}
            onCheckedChange={(checked) => {
              void onCheckedChange(checked);
            }}
            aria-label="Default folder browser"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}

import { invoke } from "@tauri-apps/api/core";

import type { LogEventDto } from "./types";

const LOG_EVENT_COMMAND = "cmd_log_event";

export const logUiEvent = (event: LogEventDto) => {
  if (!event.event_type.trim()) {
    return;
  }

  void invoke<void>(LOG_EVENT_COMMAND, { event }).catch(() => undefined);
};

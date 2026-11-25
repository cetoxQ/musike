import { useSyncExternalStore } from "react";
import { downloads } from "../lib/api";

const none = () => () => {};

/** The tracks kept on the device, re-rendering as they change; null where there are none (only the Android app). */
export function useDownloads() {
  useSyncExternalStore(downloads?.subscribe ?? none, () => downloads?.version() ?? 0);
  return downloads;
}

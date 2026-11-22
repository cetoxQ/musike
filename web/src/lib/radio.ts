import { create } from "zustand";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import type { Track } from "./types";

/** A radio waiting to start, until the changed radio playlist it would replace is let go (see RadioReplaceDialog). */
export const useRadioAsk = create<{ track: Track | null }>(() => ({ track: null }));

/**
 * Start radio, from a button. Starting one replaces the radio playlist not saved yet: as it was made, silently;
 * changed (tracks kept, regenerated, renamed...), only after asking. Asking touches nothing: the track playing goes on.
 */
export function startRadio(track: Track) {
  const radio = useLibrary.getState().playlists.find((p) => p.radio);
  if (radio?.radio?.edited) return useRadioAsk.setState({ track });
  void usePlayer.getState().startRadio(track);
}

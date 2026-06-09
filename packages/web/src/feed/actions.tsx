import { createContext, useContext } from "react";
import type { ChatMessage } from "@app/shared";

export interface RowActions {
  isSaved: (id: string) => boolean;
  toggleSave: (m: ChatMessage) => void;
  hasNote: (id: string) => boolean;
  addNote: (m: ChatMessage) => void;
  /** start a reply to this message (quote bar in the composer) */
  reply: (m: ChatMessage) => void;
  /** forward this message into a Market Bubble room */
  forward: (m: ChatMessage) => void;
}

const ActionsContext = createContext<RowActions>({
  isSaved: () => false,
  toggleSave: () => {},
  hasNote: () => false,
  addNote: () => {},
  reply: () => {},
  forward: () => {},
});

export const ActionsProvider = ActionsContext.Provider;
export const useRowActions = () => useContext(ActionsContext);

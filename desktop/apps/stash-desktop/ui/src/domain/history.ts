/** Explorer-style Back / Forward: the places visited, and which one is showing. */
export type History<T> = { readonly entries: readonly T[]; readonly index: number };

/** Oldest places are dropped past this many. */
const MAX_ENTRIES = 100;

export const startHistory = <T,>(place: T): History<T> => ({ entries: [place], index: 0 });

export const currentPlace = <T,>(history: History<T>): T => history.entries[history.index];

/** Going somewhere new drops anything ahead of the current place, like a browser. */
export function visit<T>(history: History<T>, place: T): History<T> {
  const entries = [...history.entries.slice(0, history.index + 1), place].slice(-MAX_ENTRIES);
  return { entries, index: entries.length - 1 };
}

export const canGoBack = <T,>(history: History<T>): boolean => history.index > 0;
export const canGoForward = <T,>(history: History<T>): boolean => history.index < history.entries.length - 1;

export const goBack = <T,>(history: History<T>): History<T> => (canGoBack(history) ? { ...history, index: history.index - 1 } : history);
export const goForward = <T,>(history: History<T>): History<T> => (canGoForward(history) ? { ...history, index: history.index + 1 } : history);

import { create } from 'zustand';

interface EditorContextState {
  /** Current editor's selected connection (from QueryEditor picker). */
  connectionId: string | null;
  /** Current editor's selected database (from QueryEditor picker). */
  database: string | null;
  setContext: (connectionId: string | null, database: string | null) => void;
}

export const useEditorContext = create<EditorContextState>()((set) => ({
  connectionId: null,
  database: null,
  setContext: (connectionId, database) => set({ connectionId, database }),
}));

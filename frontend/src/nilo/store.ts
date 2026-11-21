import { create } from "zustand";
import { memoryApi, type MemoryItem, type MemoryKind } from "./api";

type MemoryState = {
  items: MemoryItem[];
  error: string | null;
  load: () => Promise<void>;
  add: (kind: MemoryKind, text: string) => Promise<void>;
  save: (id: string, text: string) => Promise<void>;
  pin: (id: string, pinned: boolean) => Promise<void>;
  activate: (id: string) => Promise<void>;
  forget: (id: string) => Promise<void>;
  forgetAll: (confirm: string) => Promise<void>;
};

export const useMemoryStore = create<MemoryState>((set, get) => ({
  items: [],
  error: null,
  load: async () => {
    try {
      set({ items: await memoryApi.list(), error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "nilo.memory.error.notFound" });
    }
  },
  add: async (kind, text) => {
    await memoryApi.create({ kind, scope: "global", text });
    await get().load();
  },
  save: async (id, text) => {
    await memoryApi.update(id, { text });
    await get().load();
  },
  pin: async (id, pinned) => {
    await memoryApi.update(id, { pinned });
    await get().load();
  },
  activate: async (id) => {
    await memoryApi.update(id, { status: "active" });
    await get().load();
  },
  forget: async (id) => {
    await memoryApi.forget(id);
    set({ items: get().items.filter((item) => item.id !== id) });
  },
  forgetAll: async (confirm) => {
    await memoryApi.forgetAll(confirm);
    set({ items: [] });
  },
}));

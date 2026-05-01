import { create } from "zustand";
import { api } from "../api/client.js";

export const useChatStore = create((set, get) => ({
  messages: [],
  loading: false,
  health: null,

  async refreshHealth() {
    const { data } = await api.get("/health");
    set({ health: data });
  },

  async ask(query) {
    const trimmed = query.trim();
    if (!trimmed || get().loading) return;

    const userMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    set((state) => ({ messages: [...state.messages, userMessage], loading: true }));

    try {
      const { data } = await api.post("/ask", { query: trimmed });
      const assistantMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer,
        confidence: data.confidence,
        sources: data.sources || [],
        chunks: data.chunks || []
      };
      set((state) => ({ messages: [...state.messages, assistantMessage], loading: false }));
      await get().refreshHealth();
      return data;
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  async feedback(message, rating) {
    const previousUser = [...get().messages].reverse().find((item) => item.role === "user");
    if (!previousUser || !message?.content) return;
    await api.post("/feedback", {
      query: previousUser.content,
      answer: message.content,
      rating
    });
    await get().refreshHealth();
  }
}));

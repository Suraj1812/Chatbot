import { create } from "zustand";
import { api } from "../api/client.js";

export const useChatStore = create((set, get) => ({
  messages: [],
  loading: false,
  loadingLabel: "",
  health: null,

  async refreshHealth() {
    const { data } = await api.get("/health");
    set({ health: data });
  },

  async ask(query) {
    const trimmed = query.trim();
    if (!trimmed || get().loading) return;

    const userMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    set((state) => ({ messages: [...state.messages, userMessage], loading: true, loadingLabel: "Searching local knowledge" }));

    let timer;
    try {
      timer = setTimeout(() => {
        if (get().loading) set({ loadingLabel: "Researching and scraping sources" });
      }, 1200);
      const { data } = await api.post("/ask", { query: trimmed });
      clearTimeout(timer);
      const assistantMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer,
        confidence: data.confidence,
        sources: data.sources || [],
        chunks: data.chunks || [],
        research: data.research
      };
      set((state) => ({ messages: [...state.messages, assistantMessage], loading: false, loadingLabel: "" }));
      await get().refreshHealth();
      return data;
    } catch (error) {
      clearTimeout(timer);
      set({ loading: false, loadingLabel: "" });
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

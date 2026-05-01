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

    const timers = [];
    try {
      timers.push(setTimeout(() => {
        if (get().loading) set({ loadingLabel: "Researching and scraping sources" });
      }, 1200));
      timers.push(setTimeout(() => {
        if (get().loading) set({ loadingLabel: "Reading pages and updating memory" });
      }, 7000));
      timers.push(setTimeout(() => {
        if (get().loading) set({ loadingLabel: "Ranking sources for the best local answer" });
      }, 14000));
      const { data } = await api.post("/ask", { query: trimmed });
      timers.forEach(clearTimeout);
      const assistantMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer,
        query: trimmed,
        confidence: data.confidence,
        sources: data.sources || [],
        chunks: data.chunks || [],
        research: data.research,
        intent: data.intent
      };
      set((state) => ({ messages: [...state.messages, assistantMessage], loading: false, loadingLabel: "" }));
      await get().refreshHealth();
      return data;
    } catch (error) {
      timers.forEach(clearTimeout);
      set({ loading: false, loadingLabel: "" });
      throw error;
    }
  },

  async feedback(message, rating) {
    const query = message?.query || [...get().messages].reverse().find((item) => item.role === "user")?.content;
    if (!query || !message?.content) return;
    await api.post("/feedback", {
      query,
      answer: message.content,
      rating
    });
    await get().refreshHealth();
  }
}));

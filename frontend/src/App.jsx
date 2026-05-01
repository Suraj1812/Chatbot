import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { Header } from "./components/Header.jsx";
import { Message } from "./components/Message.jsx";
import { ChatInput } from "./components/ChatInput.jsx";
import { DataPanel } from "./components/DataPanel.jsx";
import { apiError } from "./api/client.js";
import { useChatStore } from "./store/chatStore.js";

export default function App() {
  const [dataOpen, setDataOpen] = useState(false);
  const bottomRef = useRef(null);
  const { messages, loading, health, ask, feedback, refreshHealth } = useChatStore();

  useEffect(() => {
    refreshHealth().catch((error) => toast.error(apiError(error)));
  }, [refreshHealth]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function submit(query) {
    try {
      await ask(query);
    } catch (error) {
      toast.error(apiError(error));
    }
  }

  async function submitFeedback(message, rating) {
    try {
      await feedback(message, rating);
      toast.success(rating === "good" ? "Saved to memory" : "Feedback saved");
    } catch (error) {
      toast.error(apiError(error));
    }
  }

  return (
    <div className="min-h-screen bg-wash">
      <Header health={health} onOpenData={() => setDataOpen(true)} />
      <main className="mx-auto min-h-[calc(100vh-9rem)] max-w-5xl px-4 pb-32 pt-6">
        {!messages.length && (
          <div className="grid min-h-[50vh] place-items-center text-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Ask real local knowledge.</h2>
              <p className="mt-2 text-muted">Scrape or teach data first. No local data means no answer.</p>
            </div>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((message) => (
            <Message key={message.id} message={message} onFeedback={submitFeedback} />
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" />
              Thinking
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 border-t border-black/10 bg-wash/95 py-4 backdrop-blur">
        <ChatInput disabled={loading} onSubmit={submit} />
      </div>

      <DataPanel open={dataOpen} onClose={() => setDataOpen(false)} onChanged={refreshHealth} />
    </div>
  );
}

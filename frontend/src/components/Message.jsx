import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import { ThumbsDown, ThumbsUp } from "lucide-react";

export function Message({ message, onFeedback }) {
  const isUser = message.role === "user";
  const confidence = Math.round((message.confidence || 0) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[780px] ${isUser ? "rounded-lg bg-ink px-4 py-3 text-white" : "py-2 text-ink"}`}>
        <div className="prose prose-sm max-w-none prose-p:my-2">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>

        {!isUser && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="rounded-full border border-black/10 bg-white px-2 py-1">confidence {confidence}%</span>
              {message.sources?.map((source) => (
                <span key={source.source || source} className="rounded-full border border-black/10 bg-white px-2 py-1">
                  {source.title || source.source || source}
                </span>
              ))}
              {message.research?.attempted && (
                <span className="rounded-full border border-black/10 bg-white px-2 py-1">
                  researched {message.research.scraped || 0} pages
                </span>
              )}
            </div>
            {message.content !== "No sufficient local data found" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onFeedback(message, "good")}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-black/10 bg-white px-2 text-xs hover:bg-black/[0.03]"
                >
                  <ThumbsUp size={14} /> Good
                </button>
                <button
                  type="button"
                  onClick={() => onFeedback(message, "bad")}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-black/10 bg-white px-2 text-xs hover:bg-black/[0.03]"
                >
                  <ThumbsDown size={14} /> Bad
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

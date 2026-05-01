import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import { ThumbsDown, ThumbsUp } from "lucide-react";

function sourceLabel(source) {
  const value = source?.source || source;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return source?.title || value;
  }
}

function isHttpSource(source) {
  const value = source?.source || source;
  return /^https?:\/\//i.test(value);
}

export function Message({ message, onFeedback }) {
  const [sentRating, setSentRating] = useState("");
  const isUser = message.role === "user";
  const confidence = Math.round((message.confidence || 0) * 100);
  const canRate = !isUser && message.content !== "No sufficient local data found" && !sentRating;

  async function rate(rating) {
    if (!canRate) return;
    setSentRating(rating);
    await onFeedback(message, rating);
  }

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
              {message.sources?.map((source) => {
                const key = source.source || source;
                const className = "max-w-[260px] truncate rounded-full border border-black/10 bg-white px-2 py-1";
                return isHttpSource(source) ? (
                  <a
                    key={key}
                    href={key}
                    target="_blank"
                    rel="noreferrer"
                    className={`${className} hover:border-accent`}
                    title={key}
                  >
                    {sourceLabel(source)}
                  </a>
                ) : (
                  <span key={key} className={className} title={key}>
                    {sourceLabel(source)}
                  </span>
                );
              })}
              {message.research?.attempted && (
                <span className="rounded-full border border-black/10 bg-white px-2 py-1">
                  searched {message.research.searched || 0} · scraped {message.research.scraped || 0}
                </span>
              )}
            </div>
            {message.content !== "No sufficient local data found" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!canRate}
                  onClick={() => rate("good")}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-black/10 bg-white px-2 text-xs hover:bg-black/[0.03] disabled:opacity-60"
                >
                  <ThumbsUp size={14} /> {sentRating === "good" ? "Saved" : "Good"}
                </button>
                <button
                  type="button"
                  disabled={!canRate}
                  onClick={() => rate("bad")}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-black/10 bg-white px-2 text-xs hover:bg-black/[0.03] disabled:opacity-60"
                >
                  <ThumbsDown size={14} /> {sentRating === "bad" ? "Saved" : "Bad"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

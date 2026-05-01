import { Send } from "lucide-react";
import { useState } from "react";

export function ChatInput({ disabled, onSubmit }) {
  const [value, setValue] = useState("");

  function submit(event) {
    event.preventDefault();
    const query = value.trim();
    if (!query || disabled) return;
    setValue("");
    onSubmit(query);
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-5xl grid-cols-[1fr_auto] gap-2 px-4">
      <textarea
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        rows={1}
        placeholder="Ask your local knowledge..."
        className="max-h-36 min-h-12 resize-none rounded-lg border border-black/10 bg-white px-4 py-3 outline-none focus:border-accent disabled:opacity-60"
      />
      <button
        disabled={disabled || !value.trim()}
        type="submit"
        className="inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Send size={17} />
        Ask
      </button>
    </form>
  );
}

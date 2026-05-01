import { useState } from "react";
import toast from "react-hot-toast";
import { BookOpen, Link, Loader2, X } from "lucide-react";
import { api, apiError } from "../api/client.js";

export function DataPanel({ open, onClose, onChanged }) {
  const [url, setUrl] = useState("");
  const [learnText, setLearnText] = useState("");
  const [followLinks, setFollowLinks] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function scrape() {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/scrape", {
        urls: url,
        depth: followLinks,
        maxPages: followLinks ? 10 : 3
      });
      toast.success(`Scraped ${data.scraped}, added ${data.added}`);
      setUrl("");
      await onChanged();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(false);
    }
  }

  async function learn() {
    if (!learnText.trim() || busy) return;
    setBusy(true);
    try {
      await api.post("/learn", {
        text: learnText,
        title: "Manual learning",
        source: "manual"
      });
      toast.success("Learned");
      setLearnText("");
      await onChanged();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/30 p-4">
      <div className="mx-auto mt-16 max-w-2xl rounded-lg border border-black/10 bg-white shadow-xl">
        <div className="flex h-14 items-center justify-between border-b border-black/10 px-4">
          <strong>Data</strong>
          <button onClick={onClose} className="rounded-md p-2 hover:bg-black/[0.04]">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-4">
          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Link size={16} /> Scrape URL
            </label>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                disabled={busy}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/article"
                className="h-11 rounded-md border border-black/10 px-3 outline-none focus:border-accent"
              />
              <button
                disabled={busy || !url.trim()}
                onClick={scrape}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 font-semibold text-white disabled:opacity-60"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Scrape
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={followLinks} onChange={(event) => setFollowLinks(event.target.checked)} />
              Follow same-site links
            </label>
          </section>

          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <BookOpen size={16} /> Manual learning
            </label>
            <textarea
              disabled={busy}
              value={learnText}
              onChange={(event) => setLearnText(event.target.value)}
              rows={5}
              placeholder="Paste real notes or facts here..."
              className="w-full rounded-md border border-black/10 p-3 outline-none focus:border-accent"
            />
            <button
              disabled={busy || !learnText.trim()}
              onClick={learn}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-black/10 bg-white px-4 font-medium disabled:opacity-60"
            >
              Learn
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

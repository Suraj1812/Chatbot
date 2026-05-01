import { Database, HeartPulse } from "lucide-react";

export function Header({ health, onOpenData }) {
  return (
    <header className="sticky top-0 z-20 border-b border-black/10 bg-wash/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <HeartPulse size={18} className="text-accent" />
          <h1 className="text-base font-semibold tracking-tight">Local Knowledge</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">
            {health ? `${health.documents} sources · ${health.facts} facts${health.scrapeInProgress ? " · scraping" : ""}` : "checking..."}
          </span>
          <button
            type="button"
            onClick={onOpenData}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-black/10 bg-white px-3 text-sm font-medium hover:bg-black/[0.03]"
          >
            <Database size={16} />
            Data
          </button>
        </div>
      </div>
    </header>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import {
  AudioLines,
  ExternalLink,
  Globe,
  Loader2,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { NewsArticle } from '../types/news';
import { RichTextBlock } from './RichTextBlock';

export interface WebGroundingSource {
  title: string;
  uri: string;
}

interface SearchResearchDrawerProps {
  open: boolean;
  onClose: () => void;
  article: NewsArticle | null;
  onOpenVoiceWithArticle: (article: NewsArticle | null) => void;
}

export function SearchResearchDrawer({
  open,
  onClose,
  article,
  onOpenVoiceWithArticle,
}: SearchResearchDrawerProps) {
  const [customQuery, setCustomQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<WebGroundingSource[]>([]);
  const [searchQueries, setSearchQueries] = useState<string[]>([]);

  const runResearch = async (queryText?: string, targetArticle?: NewsArticle | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryText?.trim() || undefined,
          article: targetArticle
            ? {
                title: targetArticle.title,
                newspaper: targetArticle.newspaper,
                stateLabel: targetArticle.stateLabel,
                category: targetArticle.category,
                excerpt: targetArticle.excerpt,
                link: targetArticle.link,
              }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch Google Search insights.');
      }
      setAnswer(data.answer || '');
      setSources(data.sources || []);
      setSearchQueries(data.searchQueries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach search research service.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setCustomQuery('');
    if (article) {
      setAnswer(null);
      setSources([]);
      setSearchQueries([]);
      void runResearch(undefined, article);
    } else {
      setAnswer(null);
      setSources([]);
      setSearchQueries([]);
      setError(null);
    }
  }, [open, article]);

  if (!open) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!customQuery.trim()) return;
    void runResearch(customQuery, article);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Cross-Website Search Insights"
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-stone-200 dark:border-stone-800 bg-[#FBF9F5] dark:bg-[#161513] text-stone-900 dark:text-stone-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-[#9A3412] dark:text-amber-400" />
              <h2 className="font-serif text-xl font-semibold">
                Cross-Website Search Insights
              </h2>
            </div>
            <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
              Live Google Search grounding across news websites &amp; official sources
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close web insights"
            className="rounded-md p-2 text-stone-500 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Selected Article Banner */}
        {article && (
          <div className="border-b border-stone-200 dark:border-stone-800 bg-[#F4F0E8]/80 dark:bg-stone-900/60 px-6 py-3.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500 dark:text-stone-400">
              <span className="font-semibold text-[#9A3412] dark:text-amber-400">
                {article.newspaper} · {article.stateLabel}
              </span>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenVoiceWithArticle(article);
                }}
                className="inline-flex items-center gap-1 font-medium text-stone-700 dark:text-stone-300 hover:text-[#9A3412] dark:hover:text-amber-400"
              >
                <AudioLines className="h-3.5 w-3.5" />
                Talk about this article
              </button>
            </div>
            <h3 className="mt-1 font-serif text-sm font-semibold leading-snug text-stone-900 dark:text-stone-100">
              {article.title}
            </h3>
          </div>
        )}

        {/* Custom Search Form */}
        <form
          onSubmit={handleSubmit}
          className="border-b border-stone-200 dark:border-stone-800 px-6 py-3"
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                value={customQuery}
                onChange={(e) => setCustomQuery(e.target.value)}
                placeholder={
                  article
                    ? 'Ask a follow-up or search other outlets on this topic...'
                    : 'Search across all websites (e.g., Ooty frost impact, RBI repo rate)...'
                }
                className="w-full rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 pl-8 pr-3 py-2 text-xs text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:border-[#9A3412] dark:focus:border-amber-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !customQuery.trim()}
              className="rounded-md bg-[#9A3412] dark:bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#7C2D12] dark:hover:bg-amber-500 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              Search Web
            </button>
          </div>

          {!article && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {[
                'Latest Ooty & Nilgiris tourism and weather updates',
                'Key Indian economic & RBI updates today',
                'Top ISRO & Indian tech announcements this week',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setCustomQuery(preset);
                    void runResearch(preset, null);
                  }}
                  className="rounded border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-2.5 py-1 text-[11px] text-stone-600 dark:text-stone-300 hover:border-[#9A3412] dark:hover:border-amber-500 transition-colors text-left"
                >
                  {preset}
                </button>
              ))}
            </div>
          )}
        </form>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#9A3412] dark:text-amber-400" />
              <p className="mt-3 text-xs font-medium text-stone-600 dark:text-stone-400">
                Searching websites and synthesizing verified context...
              </p>
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 text-xs text-red-800 dark:text-red-300">
              <p className="font-semibold">Unable to complete web search</p>
              <p className="mt-1">{error}</p>
            </div>
          ) : answer ? (
            <>
              <div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/70 p-4">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9A3412] dark:text-amber-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  Synthesized Across Websites
                </div>
                <RichTextBlock content={answer} />
              </div>

              {searchQueries.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Search Queries Checked
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {searchQueries.map((q) => (
                      <span
                        key={q}
                        className="rounded bg-stone-200/70 dark:bg-stone-800 px-2 py-0.5 font-mono text-[11px] text-stone-700 dark:text-stone-300"
                      >
                        {q}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {sources.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Web Sources &amp; Other Publications ({sources.length})
                  </div>
                  <div className="mt-2 space-y-2">
                    {sources.map((src) => (
                      <a
                        key={src.uri}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-3 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-xs hover:border-[#9A3412] dark:hover:border-amber-500 transition-colors group"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-stone-900 dark:text-stone-100 truncate group-hover:text-[#9A3412] dark:group-hover:text-amber-400">
                            {src.title}
                          </div>
                          <div className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400 truncate">
                            {src.uri}
                          </div>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-stone-400 group-hover:text-[#9A3412] dark:group-hover:text-amber-400" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-10 text-center text-xs text-stone-500 dark:text-stone-400">
              Enter a topic above or click one of the prompts to search across news websites using Google Search grounding.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

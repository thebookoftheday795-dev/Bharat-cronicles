import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AudioLines,
  ExternalLink,
  Globe,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { NewsArticle } from '../types/news';
import { RichTextBlock } from './RichTextBlock';
import type { WebGroundingSource } from './SearchResearchDrawer';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  modelUsed?: string;
  sources?: WebGroundingSource[];
}

interface GeminiGuideChatbotProps {
  open: boolean;
  onClose: () => void;
  activeCategory: string;
  activeRegion: string;
  activeState: string;
  activeLanguage: string;
  visibleArticles: NewsArticle[];
  onOpenVoiceDesk: () => void;
}

const STORAGE_CHAT_KEY = 'bharat_chronicle_guide_chat_v1';

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'model',
  text: 'Welcome to **Bharat Chronicle News Guide & Support**. Ask me anything about using the app (regional desks like **Ooty & Nilgiris**, Breaking Alerts, Bookmarks, Personalize, or Admin RSS feeds), report an issue to troubleshoot, or ask for a live web-verified news briefing.',
};

function readInitialChat(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_CHAT_KEY);
    if (!raw) return [WELCOME_MESSAGE];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [WELCOME_MESSAGE];
  } catch {
    return [WELCOME_MESSAGE];
  }
}

export function GeminiGuideChatbot({
  open,
  onClose,
  activeCategory,
  activeRegion,
  activeState,
  activeLanguage,
  visibleArticles,
  onOpenVoiceDesk,
}: GeminiGuideChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(readInitialChat);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelMode, setModelMode] = useState<'hydrogen' | 'flash-lite'>('hydrogen');
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CHAT_KEY, JSON.stringify(messages.slice(-24)));
    } catch {
      // ignore storage quota
    }
  }, [messages]);

  useEffect(() => {
    if (open) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, messages, loading]);

  if (!open) return null;

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || loading) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const historyForApi = messages
      .filter((m) => m.id !== 'welcome')
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: historyForApi,
          modelMode,
          useWebSearch,
          appContext: {
            activeCategory,
            activeRegion,
            activeState,
            activeLanguage,
            totalArticles: visibleArticles.length,
            sampleHeadlines: visibleArticles.slice(0, 8).map((a) => ({
              title: a.title,
              newspaper: a.newspaper,
              stateLabel: a.stateLabel,
            })),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Chatbot request failed.');
      }

      const modelMsg: ChatMessage = {
        id: `m-${Date.now()}`,
        role: 'model',
        text: data.reply,
        modelUsed: data.modelUsed,
        sources: data.sources || [],
      };
      setMessages((prev) => [...prev, modelMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Gemini Guide.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Gemini Guide and Support Chatbot"
    >
      <div className="flex h-full w-full max-w-lg flex-col border-l border-stone-200 dark:border-stone-800 bg-[#FBF9F5] dark:bg-[#161513] text-stone-900 dark:text-stone-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[#9A3412] dark:text-amber-400" />
              <h2 className="font-serif text-xl font-semibold">
                News Guide &amp; Support
              </h2>
            </div>
            <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
              Multi-turn Gemini assistant for app help, troubleshooting &amp; live web Q&amp;A
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setMessages([WELCOME_MESSAGE]);
                setError(null);
              }}
              aria-label="Clear chat history"
              title="New conversation"
              className="rounded-md p-2 text-stone-500 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close guide chatbot"
              className="rounded-md p-2 text-stone-500 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Mode & Grounding Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-800 bg-[#F4F0E8]/70 dark:bg-stone-900/50 px-6 py-2.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setModelMode('hydrogen')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium transition-colors ${
                modelMode === 'hydrogen'
                  ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                  : 'text-stone-600 dark:text-stone-400 hover:bg-stone-200/70 dark:hover:bg-stone-800'
              }`}
            >
              <Globe className="h-3 w-3" />
              Search + Guide
            </button>
            <button
              type="button"
              onClick={() => setModelMode('flash-lite')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium transition-colors ${
                modelMode === 'flash-lite'
                  ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                  : 'text-stone-600 dark:text-stone-400 hover:bg-stone-200/70 dark:hover:bg-stone-800'
              }`}
            >
              <Zap className="h-3 w-3" />
              Fast Help
            </button>
          </div>

          <div className="flex items-center gap-3">
            {modelMode === 'hydrogen' && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-stone-600 dark:text-stone-300">
                <input
                  type="checkbox"
                  checked={useWebSearch}
                  onChange={(e) => setUseWebSearch(e.target.checked)}
                  className="rounded border-stone-300 text-[#9A3412] focus:ring-[#9A3412]"
                />
                <span>Web Grounding</span>
              </label>
            )}
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenVoiceDesk();
              }}
              className="inline-flex items-center gap-1 font-medium text-[#9A3412] dark:text-amber-400 hover:underline"
            >
              <AudioLines className="h-3 w-3" />
              Voice Mode
            </button>
          </div>
        </div>

        {/* Scrollable Chat Thread */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-[90%] rounded-lg px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-stone-900 text-white dark:bg-stone-800 text-xs sm:text-[13px] leading-relaxed'
                    : 'border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/80'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                ) : (
                  <RichTextBlock content={msg.text} />
                )}

                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 border-t border-stone-200 dark:border-stone-800 pt-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Web Sources Cited
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {msg.sources.slice(0, 5).map((src) => (
                        <a
                          key={src.uri}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 px-2 py-1 text-[11px] text-[#9A3412] dark:text-amber-400 hover:underline max-w-[240px]"
                        >
                          <span className="truncate">{src.title}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
              <Loader2 className="h-4 w-4 animate-spin text-[#9A3412] dark:text-amber-400" />
              <span>
                {modelMode === 'hydrogen' && useWebSearch
                  ? 'Searching websites & preparing guide reply...'
                  : 'Thinking...'}
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-300">
              {error}
            </div>
          )}

          <div ref={threadEndRef} />
        </div>

        {/* Starter Prompts */}
        <div className="border-t border-stone-200/80 dark:border-stone-800/80 px-6 py-2.5 flex flex-wrap gap-1.5 bg-[#F4F0E8]/40 dark:bg-stone-900/30">
          {[
            'How do I filter Ooty & Nilgiris news?',
            'Why are some feeds missing or not updating?',
            'Search web for latest India & Tamil Nadu headlines',
            'How do Breaking Alerts & Voice Desk work?',
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={loading}
              onClick={() => void sendMessage(chip)}
              className="rounded border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-2.5 py-1 text-[11px] text-stone-700 dark:text-stone-300 hover:border-[#9A3412] dark:hover:border-amber-500 transition-colors text-left"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Input Form */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-stone-200 dark:border-stone-800 px-6 py-3.5 flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a guide question, report an issue, or search news..."
            className="flex-1 rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:border-[#9A3412] dark:focus:border-amber-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send message"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#9A3412] dark:bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-[#7C2D12] dark:hover:bg-amber-500 disabled:opacity-50 transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

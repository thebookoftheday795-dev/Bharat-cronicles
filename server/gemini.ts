import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import type { WebSocket, WebSocketServer } from 'ws';

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ArticleContextInput {
  title?: string;
  newspaper?: string;
  stateLabel?: string;
  category?: string;
  excerpt?: string;
  link?: string;
}

export interface ChatHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('api_key_invalid') || lower.includes('permission_denied') || lower.includes('403')) {
    return {
      status: 403,
      message: 'Gemini API key is invalid or unauthorized. Please verify your key in Settings > Secrets.',
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429')) {
    return {
      status: 429,
      message:
        'Gemini API quota reached (429). Please retry shortly or select a billing-enabled API key in Settings > Secrets to increase your quota.',
    };
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return {
      status: 404,
      message: `Requested Gemini model is unavailable: ${raw}`,
    };
  }
  if (lower.includes('gemini_api_key is not configured')) {
    return { status: 500, message: raw };
  }
  return { status: 500, message: raw || 'Gemini request failed.' };
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      const isTransient = msg.includes('503') || msg.includes('unavailable') || msg.includes('timeout');
      if (!isTransient || attempt >= retries) {
        throw err;
      }
      attempt++;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

function extractGroundingMetadata(response: {
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string };
      }>;
      webSearchQueries?: string[];
    };
  }>;
}): { sources: GroundingSource[]; searchQueries: string[] } {
  const meta = response.candidates?.[0]?.groundingMetadata;
  const rawChunks = meta?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];

  for (const chunk of rawChunks) {
    const uri = chunk.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({
      uri,
      title: chunk.web?.title?.trim() || new URL(uri).hostname,
    });
  }

  return {
    sources,
    searchQueries: meta?.webSearchQueries ?? [],
  };
}

export async function researchWithSearchGrounding(params: {
  query?: string;
  article?: ArticleContextInput;
}): Promise<{
  answer: string;
  sources: GroundingSource[];
  searchQueries: string[];
}> {
  const ai = getGeminiClient();
  const { query, article } = params;

  const promptParts: string[] = [];
  if (article?.title) {
    promptParts.push(
      `Headline: "${article.title}"`,
      article.newspaper ? `Publisher: ${article.newspaper}` : '',
      article.stateLabel ? `Region/Bureau: ${article.stateLabel}` : '',
      article.category ? `Desk: ${article.category}` : '',
      article.excerpt ? `RSS Excerpt: ${article.excerpt}` : ''
    );
  }

  const userQuestion = query?.trim()
    ? query.trim()
    : 'Search across news websites and official sources to provide deeper context, verified facts, key timelines, and what other outlets are reporting on this story.';

  const fullPrompt = [
    ...promptParts.filter(Boolean),
    '',
    `Research request: ${userQuestion}`,
  ].join('\n');

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: fullPrompt,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction:
          'You are a senior investigative news researcher at Bharat Chronicle. Use Google Search to gather up-to-date, corroborated information from multiple reputable news websites and official publications. Present a crisp, balanced, factual briefing with: 1) Key Takeaways across websites, 2) Deeper Context & Background, and 3) Additional perspectives or updates not in the short RSS headline. Keep it well-structured, concise (around 180-280 words), and strictly factual.',
      },
    })
  );

  const { sources, searchQueries } = extractGroundingMetadata(
    response as Parameters<typeof extractGroundingMetadata>[0]
  );

  return {
    answer: (response.text ?? '').trim() || 'No additional web insights were returned for this query.',
    sources,
    searchQueries,
  };
}

export async function runGuideChatTurn(params: {
  message: string;
  history: ChatHistoryTurn[];
  modelMode?: 'hydrogen' | 'flash-lite';
  useWebSearch?: boolean;
  appContext?: {
    activeCategory?: string;
    activeRegion?: string;
    activeState?: string;
    activeLanguage?: string;
    totalArticles?: number;
    sampleHeadlines?: Array<{ title: string; newspaper: string; stateLabel: string }>;
  };
}): Promise<{
  reply: string;
  modelUsed: string;
  sources: GroundingSource[];
  searchQueries: string[];
}> {
  const ai = getGeminiClient();
  const useFast = params.modelMode === 'flash-lite';
  const modelUsed = useFast ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';
  const enableSearch = !useFast && params.useWebSearch !== false;

  const ctx = params.appContext;
  const headlinesText =
    ctx?.sampleHeadlines && ctx.sampleHeadlines.length > 0
      ? ctx.sampleHeadlines
          .slice(0, 8)
          .map((h, i) => `${i + 1}. ${h.title} (${h.newspaper} · ${h.stateLabel})`)
          .join('\n')
      : 'None currently loaded.';

  const systemInstruction = `You are the Bharat Chronicle News Guide & Support Assistant. You serve three clear roles:
1. App Navigation & Feature Guide: Help readers use Bharat Chronicle effectively — including browsing the 11 editorial desks (National, State News, Politics, Business, Economy, Technology, Sports, Education, Entertainment, Health, World News), filtering by India Regions (North, South, West, East, Central, Northeast) and specific hubs like Ooty & Nilgiris or Tamil Nadu, switching among 10 Indian languages, saving Bookmarks, checking Recently Read history, customizing the "For You" feed via Personalize, enabling Breaking Alerts, managing RSS sources in the Admin Console, opening "Web Insights" for cross-website research, and launching "Talk" for real-time voice conversations.
2. Issue & Troubleshooting Support: Diagnose user issues clearly and concisely — for instance:
   - Missing regional/state stories: check if Region, State/UT, Language, or Search filters are overly narrow and suggest Reset Filters or Sync Wire.
   - Voice conversation issues: verify browser microphone permission, active internet connection, and using "End Session" + "Start Voice" to reconnect.
   - Browser push alerts not appearing: check notification permission inside the Breaking Alerts drawer.
   - Custom RSS feeds failing: check the Admin Console feed status indicators (Healthy vs Degraded) and verify the URL is a valid public RSS/Atom XML endpoint.
3. Cross-Website News Briefing: Answer news questions accurately. When Google Search is enabled, verify fresh facts and news updates across websites.

Current reader view context:
- Category: ${ctx?.activeCategory || 'all'}
- Region: ${ctx?.activeRegion || 'all'}
- State/Area: ${ctx?.activeState || 'all'}
- Language: ${ctx?.activeLanguage || 'all'}
- Loaded articles: ${ctx?.totalArticles ?? 0}
- Sample visible headlines:
${headlinesText}

Keep replies helpful, structured, friendly, and concise. Never invent app features that do not exist.`;

  const formattedHistory = params.history.slice(-16).map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }],
  }));

  const chat = ai.chats.create({
    model: modelUsed,
    history: formattedHistory,
    config: {
      systemInstruction,
      ...(enableSearch ? { tools: [{ googleSearch: {} }] } : {}),
    },
  });

  const response = await withRetry(() => chat.sendMessage({ message: params.message }));
  const { sources, searchQueries } = extractGroundingMetadata(
    response as Parameters<typeof extractGroundingMetadata>[0]
  );

  return {
    reply: (response.text ?? '').trim() || 'I could not generate a response. Please try again.',
    modelUsed,
    sources,
    searchQueries,
  };
}

export function setupLiveVoiceWss(liveWss: WebSocketServer) {
  liveWss.on('connection', (clientWs: WebSocket) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let closed = false;

    const sendJson = (payload: unknown) => {
      if (!closed && clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const closeSession = () => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore close errors
        }
        liveSession = null;
      }
    };

    clientWs.on('message', async (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as {
          type: 'start' | 'audio' | 'text' | 'stop';
          article?: ArticleContextInput;
          voiceName?: string;
          data?: string;
          text?: string;
        };

        if (msg.type === 'start') {
          closeSession();
          const ai = getGeminiClient();
          const allowedVoices = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);
          const voiceName =
            msg.voiceName && allowedVoices.has(msg.voiceName) ? msg.voiceName : 'Zephyr';

          const article = msg.article;
          const articleContext = article?.title
            ? `The reader wants to discuss this specific news article:
- Title: "${article.title}"
- Publisher: ${article.newspaper || 'Indian Press'}
- Region / Bureau: ${article.stateLabel || 'India'}
- Category: ${article.category || 'News'}
- Summary excerpt: ${article.excerpt || 'Not provided'}
Be ready to discuss, explain, summarize, and explore the local/national impact of this story naturally in conversation.`
            : 'The reader is on Bharat Chronicle and wants to talk about current Indian news, regional updates (including Ooty & Nilgiris and all Indian states), or get spoken guidance on using the app.';

          const systemInstruction = `You are the Bharat Chronicle Live Voice Journalist & Guide. Speak clearly, warmly, and naturally in conversational English (or respond in the user's preferred Indian language if they speak to you in Hindi/Tamil/etc.). Keep spoken answers focused, crisp, and engaging (2-4 sentences per turn unless asked for more detail). ${articleContext}`;

          liveSession = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction,
            },
            callbacks: {
              onopen: () => {
                sendJson({ type: 'ready' });
              },
              onmessage: (message: LiveServerMessage) => {
                const content = message.serverContent;
                if (!content) return;

                if (content.inputTranscription?.text) {
                  sendJson({
                    type: 'inputTranscript',
                    text: content.inputTranscription.text,
                  });
                }

                if (content.outputTranscription?.text) {
                  sendJson({
                    type: 'outputTranscript',
                    text: content.outputTranscription.text,
                  });
                }

                for (const part of content.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    sendJson({
                      type: 'audio',
                      data: part.inlineData.data,
                    });
                  }
                }

                if (content.interrupted) {
                  sendJson({ type: 'interrupted' });
                }

                if (content.turnComplete) {
                  sendJson({ type: 'turnComplete' });
                }
              },
              onerror: (err: unknown) => {
                const formatted = formatGeminiError(err);
                sendJson({ type: 'error', message: formatted.message });
              },
              onclose: () => {
                sendJson({ type: 'closed' });
              },
            },
          });
          return;
        }

        if (msg.type === 'audio' && msg.data && liveSession) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
          return;
        }

        if (msg.type === 'text' && msg.text && liveSession) {
          liveSession.sendRealtimeInput({
            text: msg.text,
          });
          return;
        }

        if (msg.type === 'stop') {
          closeSession();
          sendJson({ type: 'closed' });
        }
      } catch (err) {
        const formatted = formatGeminiError(err);
        sendJson({ type: 'error', message: formatted.message });
      }
    });

    clientWs.on('close', () => {
      closed = true;
      closeSession();
    });
  });
}

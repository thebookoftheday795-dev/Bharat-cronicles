import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Volume2,
  X,
} from 'lucide-react';
import type { NewsArticle } from '../types/news';

interface TranscriptEntry {
  id: string;
  speaker: 'user' | 'gemini';
  text: string;
}

interface LiveVoiceModalProps {
  open: boolean;
  onClose: () => void;
  article: NewsArticle | null;
}

const VOICE_OPTIONS = [
  { id: 'Zephyr', label: 'Zephyr (Warm & Clear)' },
  { id: 'Kore', label: 'Kore (Crisp Anchor)' },
  { id: 'Puck', label: 'Puck (Conversational)' },
  { id: 'Charon', label: 'Charon (Deep Editorial)' },
  { id: 'Fenrir', label: 'Fenrir (Bold Studio)' },
];

function float32ToResampledInt16(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000
): Int16Array {
  if (inputSampleRate === targetSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcIdx - idx0;
    const sample = input[idx0] * (1 - frac) + input[idx1] * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(new ArrayBuffer(int16.length * 4));
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export function LiveVoiceModal({ open, onClose, article }: LiveVoiceModalProps) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [muted, setMuted] = useState(false);
  const [voiceName, setVoiceName] = useState('Zephyr');
  const [modelSpeaking, setModelSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [textInput, setTextInput] = useState('');

  // Refs for WebSocket & WebAudio callbacks (prevents stale closures)
  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mutedRef = useRef(false);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const stopPlaybackQueue = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
    setModelSpeaking(false);
  }, []);

  const cleanupSession = useCallback(() => {
    stopPlaybackQueue();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    setMicLevel(0);
    setModelSpeaking(false);
  }, [stopPlaybackQueue]);

  useEffect(() => {
    if (!open) {
      cleanupSession();
      setStatus('idle');
      setErrorMsg(null);
      setTranscripts([]);
    }
  }, [open, cleanupSession]);

  useEffect(() => {
    return () => {
      cleanupSession();
    };
  }, [cleanupSession]);

  const appendTranscript = useCallback((speaker: 'user' | 'gemini', chunk: string) => {
    if (!chunk) return;
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: `${last.text}${chunk}` },
        ];
      }
      return [
        ...prev,
        { id: `${speaker}-${Date.now()}-${Math.random()}`, speaker, text: chunk },
      ];
    });
  }, []);

  const playPcmChunk = useCallback((base64Audio: string) => {
    const outCtx = outputCtxRef.current;
    if (!outCtx) return;

    if (outCtx.state === 'suspended') {
      void outCtx.resume();
    }

    const float32 = base64PcmToFloat32(base64Audio);
    const buffer = outCtx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = outCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(outCtx.destination);

    const now = outCtx.currentTime;
    const startAt = Math.max(now, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);
    setModelSpeaking(true);

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setModelSpeaking(false);
      }
    };
  }, []);

  const startLiveConversation = async () => {
    cleanupSession();
    setErrorMsg(null);
    setTranscripts([]);
    setStatus('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            voiceName,
            article: article
              ? {
                  title: article.title,
                  newspaper: article.newspaper,
                  stateLabel: article.stateLabel,
                  category: article.category,
                  excerpt: article.excerpt,
                  link: article.link,
                }
              : undefined,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type: string;
            data?: string;
            text?: string;
            message?: string;
          };

          if (msg.type === 'ready') {
            setStatus('live');
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (audioEvent) => {
              if (mutedRef.current) {
                setMicLevel(0);
                return;
              }
              const channelData = audioEvent.inputBuffer.getChannelData(0);
              let sumSq = 0;
              for (let i = 0; i < channelData.length; i += 8) {
                sumSq += channelData[i] * channelData[i];
              }
              const rms = Math.sqrt(sumSq / (channelData.length / 8));
              setMicLevel(Math.min(1, rms * 5));

              if (ws.readyState === WebSocket.OPEN) {
                const pcm16 = float32ToResampledInt16(
                  channelData,
                  inputCtx.sampleRate,
                  16000
                );
                ws.send(
                  JSON.stringify({
                    type: 'audio',
                    data: int16ToBase64(pcm16),
                  })
                );
              }
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
            return;
          }

          if (msg.type === 'audio' && msg.data) {
            playPcmChunk(msg.data);
            return;
          }

          if (msg.type === 'inputTranscript' && msg.text) {
            appendTranscript('user', msg.text);
            return;
          }

          if (msg.type === 'outputTranscript' && msg.text) {
            appendTranscript('gemini', msg.text);
            return;
          }

          if (msg.type === 'interrupted') {
            stopPlaybackQueue();
            return;
          }

          if (msg.type === 'error') {
            setErrorMsg(msg.message || 'Live voice session encountered an error.');
            setStatus('error');
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        setErrorMsg('WebSocket connection error while connecting to Gemini Live.');
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
      };
    } catch (err) {
      cleanupSession();
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Microphone access is required for voice conversations.'
      );
      setStatus('error');
    }
  };

  const sendLivePromptText = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    appendTranscript('user', `${trimmed}\n`);
    wsRef.current.send(JSON.stringify({ type: 'text', text: trimmed }));
    setTextInput('');
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Live Voice Conversation"
    >
      <div className="flex h-full w-full max-w-lg flex-col border-l border-stone-200 dark:border-stone-800 bg-[#FBF9F5] dark:bg-[#161513] text-stone-900 dark:text-stone-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <AudioLines className="h-4 w-4 text-[#9A3412] dark:text-amber-400" />
              <h2 className="font-serif text-xl font-semibold">
                Live Voice News Desk
              </h2>
            </div>
            <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
              Real-time two-way voice conversation powered by Gemini Live
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              cleanupSession();
              onClose();
            }}
            aria-label="Close voice conversation"
            className="rounded-md p-2 text-stone-500 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Context Card */}
        <div className="border-b border-stone-200 dark:border-stone-800 bg-[#F4F0E8]/80 dark:bg-stone-900/60 px-6 py-3.5">
          {article ? (
            <>
              <div className="text-[11px] font-semibold text-[#9A3412] dark:text-amber-400">
                Discussing Article · {article.newspaper} ({article.stateLabel})
              </div>
              <div className="mt-1 font-serif text-sm font-semibold leading-snug">
                {article.title}
              </div>
            </>
          ) : (
            <div className="text-xs text-stone-600 dark:text-stone-300">
              <span className="font-semibold text-[#9A3412] dark:text-amber-400">
                Open Editorial Desk:
              </span>{' '}
              Talk about any Indian or regional story (including Ooty &amp; Nilgiris), or ask for spoken help navigating Bharat Chronicle.
            </div>
          )}

          {/* Voice Selector */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="text-[11px] font-medium text-stone-600 dark:text-stone-400">
              Anchor Voice:
            </label>
            <select
              value={voiceName}
              disabled={status === 'live' || status === 'connecting'}
              onChange={(e) => setVoiceName(e.target.value)}
              className="rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-2.5 py-1 text-xs disabled:opacity-60"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Audio Visualizer & Controls */}
        <div className="border-b border-stone-200 dark:border-stone-800 px-6 py-5">
          <div className="flex flex-col items-center text-center">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-full border-2 transition-all ${
                status === 'live'
                  ? modelSpeaking
                    ? 'border-[#9A3412] bg-[#9A3412]/15 text-[#9A3412] dark:border-amber-400 dark:bg-amber-500/20 dark:text-amber-300 scale-105'
                    : 'border-emerald-600 bg-emerald-600/10 text-emerald-700 dark:border-emerald-400 dark:text-emerald-400'
                  : 'border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 text-stone-500'
              }`}
            >
              {modelSpeaking ? (
                <Volume2 className="h-7 w-7 animate-pulse" />
              ) : (
                <Mic className="h-7 w-7" />
              )}
            </div>

            <div className="mt-3 text-xs font-medium">
              {status === 'idle' && 'Ready to start real-time voice conversation'}
              {status === 'connecting' && 'Connecting microphone & Gemini Live...'}
              {status === 'live' &&
                (modelSpeaking
                  ? 'Gemini is speaking (speak anytime to interrupt)'
                  : muted
                    ? 'Microphone muted'
                    : 'Listening — speak naturally about the article')}
              {status === 'error' && 'Voice session paused'}
            </div>

            {/* Mic Level Indicator */}
            {status === 'live' && !muted && (
              <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <div
                  className="h-full bg-emerald-600 dark:bg-emerald-400 transition-all duration-75"
                  style={{ width: `${Math.max(6, Math.round(micLevel * 100))}%` }}
                />
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {status !== 'live' && status !== 'connecting' ? (
                <button
                  type="button"
                  onClick={startLiveConversation}
                  className="inline-flex items-center gap-2 rounded-md bg-[#9A3412] dark:bg-amber-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#7C2D12] dark:hover:bg-amber-500 transition-colors"
                >
                  <Mic className="h-4 w-4" />
                  Start Voice Conversation
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setMuted((m) => !m)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-xs font-medium transition-colors ${
                      muted
                        ? 'border-amber-600 bg-amber-600/10 text-amber-700 dark:text-amber-300'
                        : 'border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900'
                    }`}
                  >
                    {muted ? (
                      <>
                        <MicOff className="h-3.5 w-3.5" />
                        Unmute
                      </>
                    ) : (
                      <>
                        <Mic className="h-3.5 w-3.5" />
                        Mute Mic
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      cleanupSession();
                      setStatus('idle');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 dark:bg-stone-100 px-3.5 py-2 text-xs font-semibold text-white dark:text-stone-900"
                  >
                    <PhoneOff className="h-3.5 w-3.5" />
                    End Session
                  </button>
                </>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="mt-3 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          {/* Quick Starters while Live */}
          {status === 'live' && (
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {(article
                ? [
                    'Summarize this article briefly',
                    'Why does this matter locally?',
                    'Explain the background context',
                  ]
                : [
                    'Brief me on top India news',
                    'How do I filter Ooty & Nilgiris news?',
                  ]
              ).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendLivePromptText(prompt)}
                  className="rounded border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-2.5 py-1 text-[11px] text-stone-700 dark:text-stone-300 hover:border-[#9A3412] dark:hover:border-amber-500"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Live Transcript Thread */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Live Transcript
          </div>

          {transcripts.length === 0 ? (
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {status === 'live'
                ? 'Start speaking into your microphone or tap a prompt above — live voice transcription will appear here.'
                : 'Click "Start Voice Conversation" above and allow microphone access to talk about this story in real time.'}
            </p>
          ) : (
            transcripts.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-lg px-3.5 py-2.5 text-xs leading-relaxed ${
                  entry.speaker === 'user'
                    ? 'ml-8 bg-stone-900 text-white dark:bg-stone-800'
                    : 'mr-8 border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/80 text-stone-800 dark:text-stone-200'
                }`}
              >
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">
                  {entry.speaker === 'user' ? 'You' : 'Gemini Voice Desk'}
                </div>
                <div className="whitespace-pre-wrap">{entry.text}</div>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* Optional text nudge during live session */}
        {status === 'live' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendLivePromptText(textInput);
            }}
            className="border-t border-stone-200 dark:border-stone-800 px-6 py-3 flex gap-2"
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Or type a question for Gemini to answer aloud..."
              className="flex-1 rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs focus:border-[#9A3412] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!textInput.trim()}
              aria-label="Send text prompt to voice session"
              className="rounded-md bg-[#9A3412] px-3 py-2 text-white disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

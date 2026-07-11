/**
 * Floating, draggable chat window. One ChatClient per open conversation;
 * transcript renders text bubbles, collapsed thinking, and tool chips.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatClient, type ChatEvent } from '../chat/client.js';
import {
  createConversation,
  deleteConversation,
  getMessages,
  listConversations,
  useServer,
  type ConversationInfo,
} from '../server/api.js';

const POS_KEY = 'spine-editor.chat-window';

interface Chip {
  name: string;
  ok: boolean | null; // null = running
}

type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; thinking: string; chips: Chip[] };

function entriesFromStored(
  stored: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[],
): Entry[] {
  const out: Entry[] = [];
  for (const m of stored) {
    if (m.role === 'user') {
      const first = m.content[0] as { type?: string; text?: string } | undefined;
      if (first?.type === 'text' && typeof first.text === 'string') {
        out.push({ kind: 'user', text: first.text });
      }
      continue; // tool_result carriers are not shown as bubbles
    }
    const entry: Entry & { kind: 'assistant' } = {
      kind: 'assistant',
      text: '',
      thinking: '',
      chips: [],
    };
    for (const block of m.content) {
      const b = block as { type?: string; text?: string; thinking?: string; name?: string };
      if (b.type === 'text') entry.text += b.text ?? '';
      else if (b.type === 'thinking') entry.thinking += b.thinking ?? '';
      else if (b.type === 'tool_use') entry.chips.push({ name: b.name ?? '?', ok: true });
    }
    if (entry.text || entry.thinking || entry.chips.length) out.push(entry);
  }
  return out;
}

export function ChatWindow({ onClose }: { onClose: () => void }) {
  const user = useServer((s) => s.user);
  const projectId = useServer((s) => s.projectId);
  const [box, setBox] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as {
        x: number;
        y: number;
        w: number;
        h: number;
      };
      if (typeof saved.x === 'number') return saved;
    } catch {
      /* first open */
    }
    return { x: window.innerWidth - 400, y: window.innerHeight - 560, w: 380, h: 520 };
  });
  const [conversations, setConversations] = useState<ConversationInfo[]>([]);
  const [convId, setConvId] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [input, setInput] = useState('');
  const clientRef = useRef<ChatClient | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const convIdRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem(POS_KEY, JSON.stringify(box));
  }, [box]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  const onEvent = useCallback((e: ChatEvent) => {
    if (e.kind === 'ready') {
      setConvId(e.conversation);
      convIdRef.current = e.conversation;
      setConversations((prev) =>
        prev.some((c) => c.id === e.conversation)
          ? prev
          : [{ id: e.conversation, title: e.title, project_id: null, updated_at: '' }, ...prev],
      );
    } else if (e.kind === 'delta' || e.kind === 'thinking') {
      setEntries((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (!last || last.kind !== 'assistant') {
          next.push({
            kind: 'assistant',
            text: e.kind === 'delta' ? e.text : '',
            thinking: e.kind === 'thinking' ? e.text : '',
            chips: [],
          });
          return next;
        }
        next[next.length - 1] = {
          ...last,
          text: e.kind === 'delta' ? last.text + e.text : last.text,
          thinking: e.kind === 'thinking' ? last.thinking + e.text : last.thinking,
        };
        return next;
      });
    } else if (e.kind === 'tool') {
      setEntries((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (!last || last.kind !== 'assistant') {
          next.push({
            kind: 'assistant',
            text: '',
            thinking: '',
            chips: [{ name: e.name, ok: null }],
          });
          return next;
        }
        next[next.length - 1] = { ...last, chips: [...last.chips, { name: e.name, ok: null }] };
        return next;
      });
    } else if (e.kind === 'tool-result') {
      setEntries((prev) =>
        prev.map((entry, i) =>
          i === prev.length - 1 && entry.kind === 'assistant'
            ? {
                ...entry,
                chips: entry.chips.map((c, j) =>
                  j === entry.chips.length - 1 && c.ok === null ? { ...c, ok: e.ok } : c,
                ),
              }
            : entry,
        ),
      );
    } else if (e.kind === 'turn-done') {
      setRunning(false);
    } else if (e.kind === 'title') {
      setConversations((prev) =>
        prev.map((c) => (c.id === convIdRef.current ? { ...c, title: e.text } : c)),
      );
    } else if (e.kind === 'error') {
      setRunning(false);
      setNotice(e.message);
    } else if (e.kind === 'closed') {
      setRunning(false);
    }
  }, []);

  const openConversation = useCallback(
    async (id: number | null) => {
      clientRef.current?.dispose();
      setEntries([]);
      setNotice('');
      setConvId(id);
      convIdRef.current = id;
      if (id != null) {
        const stored = await getMessages(id);
        setEntries(entriesFromStored(stored));
      }
      const client = new ChatClient(onEvent);
      clientRef.current = client;
      client.connect(id ?? undefined);
    },
    [onEvent],
  );

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const list = await listConversations(projectId);
      setConversations(list);
      await openConversation(list[0]?.id ?? null);
    })();
    return () => clientRef.current?.dispose();
    // deliberately keyed on `user` only: re-listing on every autosaved
    // project rebind would tear down a live chat mid-turn
  }, [user]);

  function send() {
    const text = input.trim();
    if (!text || running || !clientRef.current) return;
    setEntries((prev) => [...prev, { kind: 'user', text }]);
    setInput('');
    setNotice('');
    setRunning(true);
    clientRef.current.sendUser(text);
  }

  async function newConversation() {
    const conv = await createConversation(projectId);
    setConversations((prev) => [conv, ...prev]);
    await openConversation(conv.id);
  }

  async function removeConversation() {
    if (convId == null) return;
    await deleteConversation(convId);
    const rest = conversations.filter((c) => c.id !== convId);
    setConversations(rest);
    await openConversation(rest[0]?.id ?? null);
  }

  return (
    <div
      className="chat-window"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      data-testid="chat-window"
    >
      <div
        className="chat-header"
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - box.x, dy: e.clientY - box.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const { dx, dy } = drag.current;
          setBox((b) => ({
            ...b,
            x: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx)),
            y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy)),
          }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span className="chat-title">AI Chat</span>
        <select
          value={convId ?? ''}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => void openConversation(e.target.value ? Number(e.target.value) : null)}
        >
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void newConversation()}
          title="New conversation"
        >
          +
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void removeConversation()}
          title="Delete conversation"
        >
          🗑
        </button>
        <button className="close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ×
        </button>
      </div>

      {!user ? (
        <div className="chat-empty">Sign in via Server ▸ Login to use AI chat.</div>
      ) : (
        <>
          <div className="chat-transcript" ref={scrollRef}>
            {entries.map((entry, i) =>
              entry.kind === 'user' ? (
                <div key={i} className="chat-msg user">
                  {entry.text}
                </div>
              ) : (
                <div key={i} className="chat-msg assistant">
                  {entry.thinking && (
                    <details className="chat-thinking">
                      <summary>thinking</summary>
                      {entry.thinking}
                    </details>
                  )}
                  {entry.chips.map((chip, j) => (
                    <span key={j} className={`chat-chip ${chip.ok === false ? 'err' : ''}`}>
                      🔧 {chip.name} {chip.ok === null ? '…' : chip.ok ? '✓' : '✗'}
                    </span>
                  ))}
                  {entry.text && <div className="chat-text">{entry.text}</div>}
                </div>
              ),
            )}
            {notice && <div className="chat-notice">{notice}</div>}
          </div>
          <div className="chat-input-row">
            <textarea
              value={input}
              disabled={running}
              placeholder='e.g. "create a knight and make it walk"'
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {running ? (
              <button onClick={() => clientRef.current?.stop()}>Stop</button>
            ) : (
              <button onClick={send} disabled={!input.trim()}>
                Send
              </button>
            )}
          </div>
        </>
      )}
      <div
        className="chat-resize"
        onPointerDown={(e) => {
          e.preventDefault();
          const start = { x: e.clientX, y: e.clientY, w: box.w, h: box.h };
          const move = (ev: PointerEvent) => {
            setBox((b) => ({
              ...b,
              w: Math.max(300, start.w + ev.clientX - start.x),
              h: Math.max(320, start.h + ev.clientY - start.y),
            }));
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />
    </div>
  );
}

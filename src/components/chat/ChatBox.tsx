import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/components/ui/cn';
import type { useChat } from '@/hooks/useChat';
import { useNow } from '@/hooks/useNow';
import { playSound } from '@/lib/sound';
import { useAuth } from '@/stores/authStore';
import { useReputation } from '@/stores/reputationStore';
import { toast } from '@/stores/toastStore';

const CAUGHT: Record<string, string> = {
  swear: 'Swear words aren’t allowed in chat. They were starred out.',
  spam: 'That looked like spam, so it wasn’t sent.',
  promo: 'Links and advertising aren’t allowed in chat, so that wasn’t sent.',
};

/**
 * Typed chat: the messages and the box to write in. `chat` comes from useChat.
 * Everyone must leave 3 seconds between messages. `writeHint` explains why you can't write here
 * (for example, you need a seat).
 */
export function ChatBox({ chat, className, writeHint, listClassName }: { chat: ReturnType<typeof useChat>; className?: string; writeHint?: string; listClassName?: string }) {
  const userId = useAuth((s) => s.user?.id);
  const rep = useReputation((s) => s.rep);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState<Set<number>>(new Set());
  const now = useNow(250);
  const list = useRef<HTMLUListElement>(null);
  const inputId = useId();
  const wait = Math.max(0, Math.ceil((chat.nextAt - now) / 1000));
  const maxLength = rep?.config.max_length ?? 200;
  const banned = rep?.can_chat === false;

  // Keep the newest message in view.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy || wait > 0) return;
    setBusy(true);
    const [res, err] = await chat.send(t);
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    setText('');
    if (res.caught) {
      playSound('error');
      if (res.warned) toast.info(CAUGHT[res.caught], 'This is your one warning for today. Next time it costs reputation.');
      else toast.error(CAUGHT[res.caught], `You lost ${res.penalty ?? 0} reputation.${res.can_chat ? '' : ' Typed chat is now switched off for you.'}`);
    } else {
      playSound('pop');
    }
  };

  const report = async (id: number) => {
    const err = await chat.report(id);
    if (err) return toast.error(err);
    setReported((s) => new Set(s).add(id));
    toast.success('Message reported', 'A moderator will look at it.');
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <ul ref={list} className={cn('scrollbar-thin min-h-0 space-y-1 overflow-y-auto overscroll-contain rounded-xl bg-ink-950/50 p-2 text-sm', listClassName ?? 'h-40')} aria-live="polite" aria-label="Chat messages">
        {chat.error ? (
          <li className="text-muted">{chat.error}</li>
        ) : chat.messages.length === 0 ? (
          <li className="text-muted">Nothing said yet.</li>
        ) : (
          chat.messages.map((m) => (
            <li key={m.id} className="group flex items-start gap-1.5 break-words text-cream/90">
              <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className={cn('font-semibold', m.user_id === userId ? 'text-gold-200' : 'text-ivory')}>{m.username}:</span> {m.body}
              </p>
              {m.user_id !== userId &&
                (reported.has(m.id) ? (
                  <span className="shrink-0 text-[0.65rem] text-muted">Reported</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void report(m.id)}
                    aria-label={`Report this message from ${m.username}`}
                    title="Report this message"
                    className="shrink-0 rounded px-1 text-[0.65rem] text-subtle opacity-60 hover:text-ruby-300 hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    Report
                  </button>
                ))}
            </li>
          ))
        )}
      </ul>
      {banned ? (
        <p className="mt-2 rounded-lg border border-ruby-500/30 bg-ruby-900/20 p-2 text-xs text-cream/85">
          Typed chat is switched off for you at the moment.{' '}
          <Link to="/profile" className="font-semibold text-gold-300 underline">
            See why on your profile
          </Link>
        </p>
      ) : !chat.canWrite ? (
        <p className="mt-2 text-xs text-muted">{writeHint ?? 'You can read this chat but not write in it.'}</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="mt-2 flex gap-1.5">
          <label className="sr-only" htmlFor={inputId}>
            Message
          </label>
          <input
            id={inputId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={maxLength}
            autoComplete="off"
            placeholder="Say something…"
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/15 bg-ink-950/60 px-2.5 text-sm text-ivory placeholder:text-subtle"
          />
          <button
            type="submit"
            disabled={busy || wait > 0 || !text.trim()}
            className="h-9 shrink-0 rounded-lg bg-gold-500 px-3 text-sm font-semibold text-ink-950 transition enabled:hover:bg-gold-400 disabled:opacity-50"
          >
            {wait > 0 ? `${wait}s` : 'Send'}
          </button>
        </form>
      )}
    </div>
  );
}

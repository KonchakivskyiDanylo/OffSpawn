import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { lastRound, sendSupport } from '@/analytics/client';
import { MAX_MESSAGE_CHARS, type SupportKind } from '@/analytics/types';
import { Modal, OptionCard, OptionGrid } from './ui';

/**
 * "Report a problem or suggest something", from any page.
 *
 * Lives in the header rather than on each game, because the things people
 * write in about are not all about a game — a missing category, a broken
 * page, a wrong birthday. When they have just finished a round it offers to
 * attach it, which turns "this result looks wrong" into a report that already
 * says which board, which clue and which of two players with the same handle.
 *
 * Requests land in the inbox on `/analytics`.
 */

const KINDS: { id: SupportKind; label: string; hint: string }[] = [
  { id: 'wrong-data', label: '📊 Wrong data', hint: 'A result, age, team or number that is not right.' },
  { id: 'bug', label: '🐞 Bug', hint: 'Something broke or behaved oddly.' },
  { id: 'category', label: '🔟 New category', hint: 'A Tenite board, a List, a rule you want to see.' },
  { id: 'suggestion', label: '💡 Suggestion', hint: 'Anything else that would make a game better.' },
];

type Stage = 'editing' | 'sending' | 'sent' | 'failed';

export function SupportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen(true)}
        aria-label="Report a problem or suggest something"
        title="Report a problem or suggest something"
      >
        💬
      </button>
      {/* Portalled: the header's backdrop blur makes it the containing block
          for anything fixed inside it, which pinned the modal to the header
          and pushed its top off the screen. */}
      {open ? createPortal(<SupportForm onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}

function SupportForm({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation();
  const round = lastRound();
  const [kind, setKind] = useState<SupportKind>('wrong-data');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [attach, setAttach] = useState(Boolean(round));
  /** Never shown: a person leaves it empty, a form-filling bot does not. */
  const [website, setWebsite] = useState('');
  const [stage, setStage] = useState<Stage>('editing');

  const submit = async () => {
    if (!message.trim()) return;
    setStage('sending');
    const ok = await sendSupport(
      {
        kind,
        message: message.trim(),
        contact: contact.trim() || undefined,
        context: { page: pathname, round: attach && round ? round.record : undefined },
      },
      website,
    );
    setStage(ok ? 'sent' : 'failed');
  };

  return (
    <Modal open title="Report or suggest" onClose={onClose}>
      {stage === 'sent' ? (
        <div className="stack">
          <p>Thanks — it is in. If you left a contact, you may hear back.</p>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <OptionGrid>
            {KINDS.map((option) => (
              <OptionCard
                key={option.id}
                label={option.label}
                hint={option.hint}
                selected={kind === option.id}
                onClick={() => setKind(option.id)}
              />
            ))}
          </OptionGrid>

          <label className="stack-sm">
            <span className="field-label">What happened, or what would you like?</span>
            <textarea
              className="input"
              rows={5}
              maxLength={MAX_MESSAGE_CHARS}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              required
            />
          </label>

          <label className="stack-sm">
            <span className="field-label">How to reach you (optional)</span>
            <input
              className="input"
              value={contact}
              maxLength={200}
              placeholder="Discord, email, anything — only if you want an answer"
              onChange={(event) => setContact(event.target.value)}
            />
          </label>

          <input
            className="support-trap"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />

          {round ? (
            <label className="row small">
              <input type="checkbox" checked={attach} onChange={(event) => setAttach(event.target.checked)} />
              Attach my last round: <strong>{round.title}</strong>
            </label>
          ) : null}

          {stage === 'failed' ? (
            <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>
              Could not send it — the server did not answer. Try again in a minute.
            </p>
          ) : null}

          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={stage === 'sending' || !message.trim()}
          >
            {stage === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </Modal>
  );
}

/**
 * Picks entries by their id: a text box that lists the entries whose names hold what is typed,
 * each with what it is and when it was first named, so two entries that share a name are offered
 * apart. Names are not keys; the id is what is picked.
 *
 * It follows the WAI-ARIA combobox pattern with a list: type to narrow, the up and down arrows to
 * move through the list, Enter to pick, Escape to close the list (and a second Escape to clear the
 * text). How many entries match is said in a status line a screen reader reads out. Picked entries
 * are shown as chips, each removed by its own button.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { EntryRecord, Id } from '@timeweft/contract';
import { AuthorOnlyMark } from './marks.tsx';
import { entryPickerCountInWords, entryPickerOptions, entryToldApartInWords } from './shaping.ts';

export interface EntryPickerProperties {
  /** What the box is for, said beside it: "With", "About". */
  label: string;
  entries: readonly EntryRecord[];
  /** Scene ids to numbers, to say when each entry was first named. */
  sceneNumbers: Map<Id, number>;
  pickedIds: readonly Id[];
  onChange: (pickedIds: Id[]) => void;
  /** Leave author-only entries out, and say how many were left out. */
  leaveOutAuthorOnly?: boolean;
  /** One entry or many. With one, picking another replaces it. */
  multiple?: boolean;
  /** A quiet line under the box. */
  hint?: string;
}

export function EntryPicker({ label, entries, sceneNumbers, pickedIds, onChange, leaveOutAuthorOnly = false, multiple = true, hint }: EntryPickerProperties) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const statusId = `${baseId}-status`;
  const hintId = `${baseId}-hint`;
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputReference = useRef<HTMLInputElement>(null);

  const offer = useMemo(
    () => entryPickerOptions(entries, typed, sceneNumbers, { pickedIds, leaveOutAuthorOnly }),
    [entries, typed, sceneNumbers, pickedIds, leaveOutAuthorOnly],
  );
  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const picked = pickedIds.map((id) => entriesById.get(id)).filter((entry): entry is EntryRecord => entry !== undefined);
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const activeOption = open && activeIndex >= 0 && activeIndex < offer.options.length ? offer.options[activeIndex] : undefined;

  const pick = (entryId: Id) => {
    onChange(multiple ? [...pickedIds, entryId] : [entryId]);
    setTyped('');
    setOpen(false);
    setActiveIndex(-1);
    inputReference.current?.focus();
  };
  const remove = (entryId: Id) => {
    onChange(pickedIds.filter((id) => id !== entryId));
    inputReference.current?.focus();
  };

  const keyPressed = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(event.key === 'ArrowDown' ? 0 : offer.options.length - 1);
        return;
      }
      if (offer.options.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + step + offer.options.length) % offer.options.length);
    } else if (event.key === 'Enter') {
      if (open && activeOption !== undefined) {
        event.preventDefault();
        pick(activeOption.entryId);
      } else if (open) {
        // Enter never sends a form the picker sits in while its list is open.
        event.preventDefault();
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      } else if (typed !== '') {
        event.preventDefault();
        setTyped('');
      }
    } else if (event.key === 'Backspace' && typed === '' && pickedIds.length > 0) {
      // An empty box: Backspace takes off the last chip, as it does in most pickers.
      const lastPicked = pickedIds[pickedIds.length - 1];
      if (lastPicked !== undefined) remove(lastPicked);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const hasHint = hint !== undefined || offer.authorOnlyLeftOut > 0;
  const describedBy = hasHint ? `${hintId} ${statusId}` : statusId;
  return (
    <div className="entry-picker">
      <label htmlFor={inputId} className="entry-picker-label">{label}</label>
      {picked.length > 0 && (
        <ul className="picked-chips" aria-label={`Picked for “${label}”`}>
          {picked.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="picked-chip"
                onClick={() => remove(entry.id)}
                aria-label={`Remove ${entry.name} (${entryToldApartInWords(entry, sceneNumbers)})`}
              >
                {entry.name} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="entry-picker-box">
        <input
          ref={inputReference}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeOption === undefined ? undefined : optionId(activeIndex)}
          aria-describedby={describedBy}
          placeholder="Type a name"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={keyPressed}
          onBlur={() => {
            setOpen(false);
            setActiveIndex(-1);
          }}
        />
        <ul id={listId} role="listbox" aria-label={`Entries for “${label}”`} className="entry-picker-list" hidden={!open || offer.options.length === 0}>
          {offer.options.map((option, index) => (
            <li
              key={option.entryId}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'entry-picker-option active' : 'entry-picker-option'}
              // Pressing would take focus off the box before the click lands; keep it there.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option.entryId)}
            >
              <span className="entry-picker-name">{option.name}</span>
              {option.matchedOtherName !== null && <span className="quiet"> (also “{option.matchedOtherName}”)</span>}
              {' '}<span className="quiet entry-picker-told-apart">{option.toldApart}</span>
              {option.isAuthorOnly && <> <AuthorOnlyMark visibility="author-only" /></>}
            </li>
          ))}
          {offer.moreNotOffered > 0 && (
            <li role="presentation" className="quiet entry-picker-more">{offer.moreNotOffered} more; type more of the name to narrow them.</li>
          )}
        </ul>
      </div>
      <p id={statusId} role="status" className={open ? 'quiet field-hint' : 'visually-hidden'}>
        {open ? entryPickerCountInWords(offer) : ''}
      </p>
      {hasHint && (
        <p id={hintId} className="quiet field-hint">
          {hint}
          {offer.authorOnlyLeftOut > 0 && `${hint === undefined ? '' : ' '}${offer.authorOnlyLeftOut === 1 ? '1 author-only entry is' : `${offer.authorOnlyLeftOut} author-only entries are`} left out.`}
        </p>
      )}
    </div>
  );
}

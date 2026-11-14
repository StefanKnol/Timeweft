/**
 * The list of a run's scenes: newest first unless the author turned it, a step at a time, found by
 * number, by words (the list's own, and the scenes' text in the store when asked), by a star, by
 * struck takes, or by the entries a scene is with.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Id, RunOutline, SceneOutline, SceneSearchMatch } from '@timeweft/contract';
import { EntryPicker } from './EntryPicker.tsx';
import { useCallOperation } from './calling.tsx';
import { useRememberedOrder } from './useRememberedOrder.ts';
import { readLocalText, useRememberedScroll } from './useSectionState.ts';
import {
  NO_SCENE_LIST_FILTERS, SCENES_SHOWN_AT_A_TIME, excerptAroundMatch, hashOfRoute, hashOfScene, lastReadStorageKey, newestStandingScene,
  orderedForDrawing, sceneChipCounts, sceneCountInWords, sceneFromItemId, sceneListIsNarrowed, sceneNumberFromText, sceneNumbersById,
  sceneSlotsMatchingFilters, scenesByNumber, scenesInvolvingEntry, searchedFieldInWords, shownAfterShowingOlder, textSearchAppliesTo, textSearchFindsFor,
  type SceneListState, type SceneSlot,
} from './shaping.ts';

/** How long typing pauses before the list narrows to it. */
const SEARCH_PAUSE_MILLISECONDS = 150;

/** How many scenes the store's search of the scenes' text hands back at most. */
const TEXT_SEARCH_LIMIT = 200;

export function SceneList({ snapshot, state, setState }: {
  snapshot: RunOutline;
  state: SceneListState;
  setState: Dispatch<SetStateAction<SceneListState>>;
}) {
  const runSlug = snapshot.run.slug;
  const callOperation = useCallOperation();
  const [order, chooseOrder] = useRememberedOrder('scenes');
  const readRememberedScroll = useRememberedScroll(runSlug, 'scenes', true);
  const [typedSearch, setTypedSearch] = useState(state.searchText);
  const [textSearchRunning, setTextSearchRunning] = useState(false);
  const [textSearchRefusal, setTextSearchRefusal] = useState<string | null>(null);
  const [goToText, setGoToText] = useState('');
  const [goToRefusal, setGoToRefusal] = useState<string | null>(null);
  const [markedNumber, setMarkedNumber] = useState<number | null>(null);

  const slots = useMemo(() => scenesByNumber(snapshot.scenes), [snapshot.scenes]);
  const entryIndex = useMemo(() => scenesInvolvingEntry(snapshot), [snapshot]);
  const sceneNumbers = useMemo(() => sceneNumbersById(snapshot.scenes), [snapshot.scenes]);
  const chipCounts = useMemo(() => sceneChipCounts(slots), [slots]);
  const textFinds = useMemo(
    () => textSearchFindsFor({ searchText: state.searchText, textSearch: state.textSearch }),
    [state.searchText, state.textSearch],
  );
  const foundInTextSceneIds = useMemo(() => new Set(textFinds.keys()), [textFinds]);
  const matching = useMemo(
    () => sceneSlotsMatchingFilters(slots, state, entryIndex, foundInTextSceneIds),
    [slots, state, entryIndex, foundInTextSceneIds],
  );
  const narrowed = sceneListIsNarrowed(state);
  const drawn = orderedForDrawing(matching, order, state.shownCount, SCENES_SHOWN_AT_A_TIME);

  // Typing narrows the list once it pauses, so a long list is not redrawn on every key.
  useEffect(() => {
    if (typedSearch === state.searchText) return;
    const timer = setTimeout(() => {
      setMarkedNumber(null);
      setState((current) => ({ ...current, searchText: typedSearch, shownCount: SCENES_SHOWN_AT_A_TIME }));
    }, SEARCH_PAUSE_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [typedSearch, state.searchText, setState]);

  // Coming back from a scene: its row is brought into view and marked, and focus is put on it.
  // Otherwise the page goes back to where it was scrolled. This runs after the run page's own
  // scroll to the section heading, so the list's place wins on a return.
  const listReference = useRef<HTMLOListElement>(null);
  const placeRestored = useRef(false);
  useEffect(() => {
    if (placeRestored.current) return;
    placeRestored.current = true;
    const returnTo = state.returnToNumber;
    if (returnTo !== null) {
      setState((current) => ({ ...current, returnToNumber: null }));
      const row = listReference.current?.querySelector<HTMLElement>(`[data-scene-number="${returnTo}"]`);
      if (row !== null && row !== undefined) {
        setMarkedNumber(returnTo);
        row.scrollIntoView({ block: 'center' });
        row.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
        return;
      }
    }
    const scrollY = readRememberedScroll();
    if (scrollY !== null && scrollY > 0) window.scrollTo(0, scrollY);
  }, [state.returnToNumber, setState, readRememberedScroll]);

  const changeFilters = (change: Partial<SceneListState>) => {
    setMarkedNumber(null);
    setState((current) => ({ ...current, ...change, shownCount: SCENES_SHOWN_AT_A_TIME }));
  };
  const clearEverything = () => {
    setTypedSearch('');
    setTextSearchRefusal(null);
    changeFilters({ ...NO_SCENE_LIST_FILTERS, textSearch: null });
  };

  const searchTheText = async () => {
    const text = typedSearch.trim();
    setState((current) => ({ ...current, searchText: typedSearch, shownCount: SCENES_SHOWN_AT_A_TIME }));
    if (text.length < 2) {
      setTextSearchRefusal('Type at least two letters to search the scenes’ text.');
      return;
    }
    setTextSearchRefusal(null);
    setTextSearchRunning(true);
    const outcome = await callOperation('search_scenes', { run: runSlug, text, includeStruck: true, limit: TEXT_SEARCH_LIMIT });
    setTextSearchRunning(false);
    if (outcome.kind === 'answer') {
      setState((current) => ({ ...current, textSearch: { text, matches: outcome.answer.matches, total: outcome.answer.total } }));
    } else if (outcome.kind === 'refusal') {
      setTextSearchRefusal(outcome.refusal);
    } else if (outcome.kind === 'fault') {
      setTextSearchRefusal(`The scenes’ text could not be searched: ${outcome.fault}`);
    }
  };

  const goToScene = () => {
    const parsed = sceneNumberFromText(goToText);
    if (!parsed.ok) {
      setGoToRefusal(parsed.reason);
      return;
    }
    window.location.hash = hashOfRoute({ page: 'run', slug: runSlug, section: 'scenes', itemId: String(parsed.number) });
  };

  if (slots.length === 0) return <p>No scenes have been saved yet.</p>;

  const newest = newestStandingScene(snapshot);
  const lastReadText = readLocalText(lastReadStorageKey(runSlug));
  const lastRead = lastReadText === null ? null : sceneFromItemId(snapshot.scenes, lastReadText);
  const continueScene = lastRead !== null && lastRead.found === 'take' ? lastRead.scene : null;

  const showOlderButton = drawn.olderNotShown > 0 && (
    <p className="show-older">
      <button
        type="button"
        className="quiet-button"
        onClick={() => setState((current) => ({ ...current, shownCount: shownAfterShowingOlder(current.shownCount, SCENES_SHOWN_AT_A_TIME, matching.length) }))}
      >
        Show older ({drawn.showOlderWouldAdd} more of {drawn.olderNotShown})
      </button>
    </p>
  );

  return (
    <>
      <div className="list-controls">
        <div className="scene-list-top-row">
        <p className="scene-list-top">
          {newest !== null && <>Newest: <a href={hashOfScene(runSlug, newest)}>scene {newest.number}</a></>}
          {continueScene !== null && (
            <>
              <span aria-hidden="true"> · </span>
              Continue reading: <a href={hashOfScene(runSlug, continueScene)}>scene {continueScene.number}</a>
            </>
          )}
        </p>
        <form
          className="inline-form go-to-scene"
          onSubmit={(event) => {
            event.preventDefault();
            goToScene();
          }}
        >
          <label htmlFor="go-to-scene">Go to scene</label>
          <input
            id="go-to-scene"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="number-box"
            value={goToText}
            aria-describedby={goToRefusal === null ? undefined : 'go-to-scene-refusal'}
            onChange={(event) => {
              setGoToText(event.target.value);
              setGoToRefusal(null);
            }}
          />
          <button type="submit" className="quiet-button">Go</button>
          {goToRefusal !== null && <span id="go-to-scene-refusal" className="refusal" role="alert">{goToRefusal}</span>}
        </form>
        </div>

        <form
          role="search"
          className="scene-search"
          onSubmit={(event) => {
            event.preventDefault();
            void searchTheText();
          }}
        >
          <label htmlFor="scene-search-box">Search the scenes</label>
          <div className="scene-search-row">
            <input
              id="scene-search-box"
              type="search"
              autoComplete="off"
              value={typedSearch}
              aria-describedby="scene-search-hint"
              onChange={(event) => {
                setTypedSearch(event.target.value);
                setTextSearchRefusal(null);
              }}
            />
            <button type="submit" className="quiet-button" aria-disabled={textSearchRunning ? 'true' : undefined}>
              {textSearchRunning ? 'Searching the text…' : 'Search the text too'}
            </button>
          </div>
          <p id="scene-search-hint" className="quiet field-hint">
            By number, title, summary and the rest; Enter also searches each scene’s text.
          </p>
          {textSearchRefusal !== null && <p className="refusal" role="alert">{textSearchRefusal}</p>}
        </form>

        <div className="chip-row" role="group" aria-label="Show only">
          <button type="button" className="chip" aria-pressed={state.starredOnly} onClick={() => changeFilters({ starredOnly: !state.starredOnly })}>
            <span aria-hidden="true">★ </span>Starred ({chipCounts.starred})
          </button>
          <button type="button" className="chip" aria-pressed={state.withStruckTakesOnly} onClick={() => changeFilters({ withStruckTakesOnly: !state.withStruckTakesOnly })}>
            Has struck takes ({chipCounts.withStruckTakes})
          </button>
        </div>
        <EntryPicker
          label="With"
          entries={snapshot.entries}
          sceneNumbers={sceneNumbers}
          pickedIds={state.withEntryIds}
          onChange={(withEntryIds: Id[]) => changeFilters({ withEntryIds })}
          hint="Set there, first naming it, or a note or fact about it. With two or more, a scene has all."
        />

        <div className="count-and-order">
          <p className="quiet scene-count" role="status">
            {sceneCountInWords(slots.length, matching.length, drawn.shown.length, narrowed)}
            {state.textSearch !== null && textSearchAppliesTo(state) && (
              <>. {textSearchInWords(state.textSearch.total, state.textSearch.matches.length)}</>
            )}
          </p>
          <div className="order-switch" role="group" aria-label="Order">
            <button type="button" className="chip" aria-pressed={order === 'newest-first'} onClick={() => chooseOrder('newest-first')}>Newest first</button>
            <button type="button" className="chip" aria-pressed={order === 'oldest-first'} onClick={() => chooseOrder('oldest-first')}>Oldest first</button>
          </div>
          {narrowed && <button type="button" className="quiet-button" onClick={clearEverything}>Clear</button>}
        </div>
      </div>

      {matching.length === 0 ? (
        <div className="no-match">
          <p>No scene matches.</p>
          <p><button type="button" onClick={clearEverything}>Clear the search and filters</button></p>
        </div>
      ) : (
        <>
          {drawn.showOlderAt === 'top' && showOlderButton}
          <ol className="plain-list scene-rows" ref={listReference}>
            {drawn.shown.map((slot) => (
              <SceneRow
                key={slot.number}
                slot={slot}
                runSlug={runSlug}
                marked={slot.number === markedNumber}
                textFinds={textFinds}
                struckOpen={state.withStruckTakesOnly || state.openStruckNumbers.includes(slot.number)}
                onStruckToggled={(open) => setState((current) => ({
                  ...current,
                  openStruckNumbers: open
                    ? [...current.openStruckNumbers.filter((number) => number !== slot.number), slot.number]
                    : current.openStruckNumbers.filter((number) => number !== slot.number),
                }))}
              />
            ))}
          </ol>
          {drawn.showOlderAt === 'foot' && showOlderButton}
        </>
      )}
    </>
  );
}

/** What the count line adds once the store has searched the scenes' text for the words typed. */
function textSearchInWords(total: number, listed: number): string {
  const found = total === 0 ? 'The scenes’ text was searched too; no scene holds the words.' : `The scenes’ text was searched too: ${total === 1 ? '1 scene holds' : `${total} scenes hold`} the words.`;
  return total > listed ? `${found} Only the newest ${listed} of them are counted here.` : found;
}

function SceneRow({ slot, runSlug, marked, textFinds, struckOpen, onStruckToggled }: {
  slot: SceneSlot;
  runSlug: string;
  marked: boolean;
  textFinds: Map<Id, SceneSearchMatch>;
  struckOpen: boolean;
  onStruckToggled: (open: boolean) => void;
}) {
  const find = slot.standing === null ? undefined : textFinds.get(slot.standing.id);
  return (
    <li className={marked ? 'scene-row-item row-returned-to' : 'scene-row-item'} data-scene-number={slot.number}>
      {slot.standing === null ? (
        <p className="scene-row quiet">
          <span className="scene-row-line"><span className="scene-number">{slot.number}.</span> Every take was struck.</span>
        </p>
      ) : (
        <SceneRowLink scene={slot.standing} href={hashOfScene(runSlug, slot.standing)} struckCount={slot.struck.length} find={find} />
      )}
      {slot.struck.length > 0 && (
        <details className="struck-takes" open={struckOpen} onToggle={(event) => {
          const open = event.currentTarget.open;
          if (open !== struckOpen) onStruckToggled(open);
        }}>
          <summary>{slot.struck.length === 1 ? '1 struck take' : `${slot.struck.length} struck takes`} of scene {slot.number}</summary>
          <ul className="plain-list">
            {slot.struck.map((scene) => (
              <li key={scene.id} className="struck">
                <SceneRowLink scene={scene} href={hashOfScene(runSlug, scene)} struckCount={0} find={textFinds.get(scene.id)} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** One compact row: the whole of it is the link. */
function SceneRowLink({ scene, href, struckCount, find }: { scene: SceneOutline; href: string; struckCount: number; find: SceneSearchMatch | undefined }) {
  const isStruck = scene.status === 'struck';
  // The title and summary are already on the row; an excerpt is shown only where the words were
  // found somewhere else, such as the scene's own text.
  const showExcerpt = find !== undefined && find.field !== 'title' && find.field !== 'summary';
  const excerpt = showExcerpt ? excerptAroundMatch(find) : null;
  return (
    <a className="scene-row" href={href}>
      <span className="scene-row-line">
        <span className="scene-number">{scene.number}.</span>
        {' '}
        <span className="scene-row-title">{isStruck ? <s>{scene.title}</s> : scene.title}</span>
        {isStruck && <span className="quiet"> (struck take)</span>}
        {scene.starred && <span className="star"><span aria-hidden="true"> ★</span><span className="visually-hidden"> starred</span></span>}
        {struckCount > 0 && <span className="quiet scene-row-mark"> · {struckCount === 1 ? '1 struck take' : `${struckCount} struck takes`}</span>}
        {scene.whenTyped !== '' && <span className="quiet scene-row-when"> · {scene.whenTyped}</span>}
      </span>
      {scene.summary !== '' && <span className="scene-row-summary quiet">{isStruck ? <s>{scene.summary}</s> : scene.summary}</span>}
      {excerpt !== null && find !== undefined && (
        <span className="scene-row-excerpt">
          <span className="quiet">In {searchedFieldInWords(find.field)}: </span>
          {excerpt.before}<mark>{excerpt.matched}</mark>{excerpt.after}
        </span>
      )}
    </a>
  );
}

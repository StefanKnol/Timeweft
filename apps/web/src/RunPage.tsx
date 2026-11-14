import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import type { RunSnapshot } from '@timeweft/contract';
import { LoadedMessage, useOperation } from './calling.tsx';
import { hashOfRoute, RUN_SECTIONS, SECTION_TITLES, titleOfRoute, type Route } from './shaping.ts';
import { ScenesSection } from './ScenesSection.tsx';
import { EntriesSection } from './EntriesSection.tsx';
import { RulingsSection } from './RulingsSection.tsx';
import { ThreadsSection } from './ThreadsSection.tsx';
import { CollisionsSection } from './CollisionsSection.tsx';
import { BriefingSection } from './BriefingSection.tsx';
import { JourneysSection } from './JourneysSection.tsx';
import { RunSection } from './RunSection.tsx';

type RunRoute = Extract<Route, { page: 'run' }>;

/** The id of the section's heading, which the "Skip to the section" link moves focus to. */
export const SECTION_HEADING_ID = 'section-heading';

export function RunPage({ route }: { route: RunRoute }) {
  const { loaded, readAgain } = useOperation('read_run', { run: route.slug });
  const snapshot = loaded.state === 'answer' ? loaded.answer : null;
  // Set by a press on a tab, read once the new section is drawn: a tab pressed scrolls to the
  // section's heading, while the browser's own Back keeps the place it remembers.
  const scrollToHeadingWhenDrawn = useRef(false);

  useEffect(() => {
    document.title = titleOfRoute(route, snapshot);
  }, [route, snapshot]);

  return (
    <article aria-labelledby="run-heading" className="run-page">
      {snapshot === null ? (
        <>
          <h1 id="run-heading" className="run-title">{route.slug}</h1>
          <LoadedMessage loaded={loaded} />
        </>
      ) : (
        <>
          <RunHeading snapshot={snapshot} />
          <SectionTabs route={route} snapshot={snapshot} scrollToHeadingWhenDrawn={scrollToHeadingWhenDrawn} />
          <SectionBody route={route} snapshot={snapshot} readAgain={readAgain} scrollToHeadingWhenDrawn={scrollToHeadingWhenDrawn} />
        </>
      )}
    </article>
  );
}

/** One line: the run's title and a quiet mark for binding or a telling. The rest is under "About this run". */
function RunHeading({ snapshot }: { snapshot: RunSnapshot }) {
  const { run } = snapshot;
  const isBinding = run.status === 'binding';
  return (
    <header className="run-heading-line">
      <h1 id="run-heading" className="run-title">{run.title}</h1>
      <span
        className="run-status-mark"
        title={isBinding ? 'What it establishes is canon' : 'Its facts stay in the run'}
      >
        {isBinding ? 'binding' : 'a telling'}
      </span>
    </header>
  );
}

function SectionTabs({ route, snapshot, scrollToHeadingWhenDrawn }: {
  route: RunRoute;
  snapshot: RunSnapshot;
  scrollToHeadingWhenDrawn: MutableRefObject<boolean>;
}) {
  const waiting = snapshot.collisions.filter((collision) => collision.state === 'waiting').length;
  const listReference = useRef<HTMLUListElement>(null);

  // On a phone the row scrolls sideways; keep the current tab inside the row's own view without
  // moving the page.
  useLayoutEffect(() => {
    const list = listReference.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (list === null || list === undefined || current === null || current === undefined) return;
    const currentLeft = current.offsetLeft - list.offsetLeft;
    const currentRight = currentLeft + current.offsetWidth;
    if (currentLeft < list.scrollLeft) list.scrollLeft = Math.max(0, currentLeft - 16);
    else if (currentRight > list.scrollLeft + list.clientWidth) list.scrollLeft = currentRight - list.clientWidth + 16;
  }, [route.section]);

  return (
    <nav aria-label="Parts of the run" className="section-tabs">
      <ul ref={listReference}>
        {RUN_SECTIONS.map((section) => {
          const href = hashOfRoute({ page: 'run', slug: route.slug, section, itemId: null });
          return (
            <li key={section}>
              <a
                href={href}
                aria-current={route.section === section ? 'page' : undefined}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if (window.location.hash === href) {
                    // The same address fires no change, so scroll now.
                    scrollHeadingIntoView();
                    return;
                  }
                  scrollToHeadingWhenDrawn.current = true;
                }}
              >
                {SECTION_TITLES[section]}
                {section === 'collisions' && waiting > 0 && <span className="count-badge"> {waiting} waiting</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Puts the section's heading just under the tabs, unless it is already in view below them. */
function scrollHeadingIntoView() {
  const heading = document.getElementById(SECTION_HEADING_ID);
  if (heading === null) return;
  const tabs = document.querySelector('.section-tabs');
  const tabsBottom = tabs === null ? 0 : tabs.getBoundingClientRect().bottom;
  const headingTop = heading.getBoundingClientRect().top;
  if (headingTop >= tabsBottom && headingTop < window.innerHeight * 0.5) return;
  heading.scrollIntoView({ block: 'start' });
}

function SectionBody({ route, snapshot, readAgain, scrollToHeadingWhenDrawn }: {
  route: RunRoute;
  snapshot: RunSnapshot;
  readAgain: () => void;
  scrollToHeadingWhenDrawn: MutableRefObject<boolean>;
}) {
  useLayoutEffect(() => {
    if (!scrollToHeadingWhenDrawn.current) return;
    scrollToHeadingWhenDrawn.current = false;
    scrollHeadingIntoView();
  }, [route.section, route.itemId, scrollToHeadingWhenDrawn]);

  const heading = <h2 id={SECTION_HEADING_ID} tabIndex={-1} className="section-heading">{SECTION_TITLES[route.section]}</h2>;
  switch (route.section) {
    case 'scenes':
      return <section className={route.itemId === null ? 'section-wide' : 'section-prose'}>{heading}<ScenesSection snapshot={snapshot} selectedSceneId={route.itemId} /></section>;
    case 'entries':
      return <section className="section-wide">{heading}<EntriesSection snapshot={snapshot} openEntryId={route.itemId} readAgain={readAgain} /></section>;
    case 'rulings':
      return <section className="section-wide">{heading}<RulingsSection snapshot={snapshot} readAgain={readAgain} /></section>;
    case 'threads':
      return <section className="section-wide">{heading}<ThreadsSection snapshot={snapshot} readAgain={readAgain} /></section>;
    case 'journeys':
      return <section className="section-wide">{heading}<JourneysSection snapshot={snapshot} readAgain={readAgain} /></section>;
    case 'collisions':
      return <section className="section-wide">{heading}<CollisionsSection snapshot={snapshot} readAgain={readAgain} /></section>;
    case 'briefing':
      return <section className="section-wide">{heading}<BriefingSection runSlug={snapshot.run.slug} /></section>;
    case 'run':
      return <section className="section-prose">{heading}<RunSection snapshot={snapshot} readAgain={readAgain} /></section>;
  }
}

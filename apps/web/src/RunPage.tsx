import type { RunSnapshot } from '@timeweft/contract';
import { LoadedMessage, useOperation } from './calling.tsx';
import { hashOfRoute, RUN_SECTIONS, type Route, type RunSection } from './shaping.ts';
import { ScenesSection } from './ScenesSection.tsx';
import { EntriesSection } from './EntriesSection.tsx';
import { RulingsSection } from './RulingsSection.tsx';
import { ThreadsSection } from './ThreadsSection.tsx';
import { CollisionsSection } from './CollisionsSection.tsx';
import { BriefingSection } from './BriefingSection.tsx';
import { JourneysSection } from './JourneysSection.tsx';
import { RunDetailsEditor } from './RunDetailsEditor.tsx';
import { BackupDownload } from './BackupDownload.tsx';

const SECTION_TITLES: Record<RunSection, string> = {
  scenes: 'Scenes',
  entries: 'People, places and things',
  rulings: 'Rulings',
  threads: 'Threads',
  journeys: 'Waypoints and journeys',
  collisions: 'Collisions',
  briefing: 'The briefing',
};

type RunRoute = Extract<Route, { page: 'run' }>;

export function RunPage({ route }: { route: RunRoute }) {
  const { loaded, readAgain } = useOperation('read_run', { run: route.slug });
  return (
    <article aria-labelledby="run-heading">
      <p><a href="#/runs">All runs</a></p>
      {loaded.state !== 'answer' ? (
        <>
          <h1 id="run-heading">{route.slug}</h1>
          <LoadedMessage loaded={loaded} />
        </>
      ) : (
        <>
          <RunHeading snapshot={loaded.answer} readAgain={readAgain} />
          <SectionTabs route={route} snapshot={loaded.answer} />
          <SectionBody route={route} snapshot={loaded.answer} readAgain={readAgain} />
        </>
      )}
    </article>
  );
}

function RunHeading({ snapshot, readAgain }: { snapshot: RunSnapshot; readAgain: () => void }) {
  const { run } = snapshot;
  return (
    <header>
      <h1 id="run-heading">{run.title}</h1>
      <p className="quiet"><code>{run.slug}</code> · {run.status === 'binding' ? 'binding: what it establishes is canon' : 'a telling: its facts stay in the run'}</p>
      {run.setting !== '' && <p>{run.setting}</p>}
      {snapshot.clocks.length > 0 && (
        <p className="quiet">Clocks: {snapshot.clocks.map((clock) => `${clock.name}${clock.countsFrom === '' ? '' : ` (from ${clock.countsFrom})`}`).join('; ')}</p>
      )}
      {run.register !== '' && <p className="quiet">Narrated: {run.register}</p>}
      <RunDetailsEditor snapshot={snapshot} readAgain={readAgain} />
      <BackupDownload runSlug={run.slug} />
    </header>
  );
}

function SectionTabs({ route, snapshot }: { route: RunRoute; snapshot: RunSnapshot }) {
  const waiting = snapshot.collisions.filter((collision) => collision.state === 'waiting').length;
  return (
    <nav aria-label="Parts of the run" className="section-tabs">
      <ul>
        {RUN_SECTIONS.map((section) => (
          <li key={section}>
            <a
              href={hashOfRoute({ page: 'run', slug: route.slug, section, itemId: null })}
              aria-current={route.section === section ? 'page' : undefined}
            >
              {SECTION_TITLES[section]}
              {section === 'collisions' && waiting > 0 && <span className="count-badge"> {waiting} waiting</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SectionBody({ route, snapshot, readAgain }: { route: RunRoute; snapshot: RunSnapshot; readAgain: () => void }) {
  const heading = <h2 className="section-heading">{SECTION_TITLES[route.section]}</h2>;
  switch (route.section) {
    case 'scenes':
      return <section>{heading}<ScenesSection snapshot={snapshot} selectedSceneId={route.itemId} /></section>;
    case 'entries':
      return <section>{heading}<EntriesSection snapshot={snapshot} openEntryId={route.itemId} readAgain={readAgain} /></section>;
    case 'rulings':
      return <section>{heading}<RulingsSection snapshot={snapshot} readAgain={readAgain} /></section>;
    case 'threads':
      return <section>{heading}<ThreadsSection snapshot={snapshot} readAgain={readAgain} /></section>;
    case 'journeys':
      return <section>{heading}<JourneysSection snapshot={snapshot} readAgain={readAgain} /></section>;
    case 'collisions':
      return <section>{heading}<CollisionsSection snapshot={snapshot} readAgain={readAgain} /></section>;
    case 'briefing':
      return <section>{heading}<BriefingSection runSlug={snapshot.run.slug} /></section>;
  }
}

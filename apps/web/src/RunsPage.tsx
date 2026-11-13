import { LoadedMessage, useOperation } from './calling.tsx';
import { hashOfRoute } from './shaping.ts';
import { ImportRunSection } from './ImportRunSection.tsx';

export function RunsPage() {
  const { loaded, readAgain } = useOperation('list_runs', {});
  return (
    <section aria-labelledby="runs-heading">
      <h1 id="runs-heading">Runs</h1>
      <LoadedMessage loaded={loaded} />
      {loaded.state === 'answer' && loaded.answer.length === 0 && <p>The store holds no runs yet.</p>}
      {loaded.state === 'answer' && loaded.answer.length > 0 && (
        <ul className="plain-list">
          {loaded.answer.map((listing) => (
            <li key={listing.run.id} className="card">
              <h2 className="card-title">
                <a href={hashOfRoute({ page: 'run', slug: listing.run.slug, section: 'scenes', itemId: null })}>
                  {listing.run.title}
                </a>
              </h2>
              <p className="quiet">
                <code>{listing.run.slug}</code> · {listing.run.status}
              </p>
              <dl className="facts-row">
                <div><dt>Scenes</dt><dd>{listing.standingScenes}</dd></div>
                <div>
                  <dt>Latest</dt>
                  <dd>
                    {listing.latest === null
                      ? 'none yet'
                      : `${listing.latest.number}. ${listing.latest.title} (${listing.latest.whenTyped})`}
                  </dd>
                </div>
                <div><dt>Open threads</dt><dd>{listing.openThreads}</dd></div>
                <div>
                  <dt>Waiting collisions</dt>
                  <dd className={listing.waitingCollisions > 0 ? 'attention' : undefined}>{listing.waitingCollisions}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <ImportRunSection onImported={readAgain} />
    </section>
  );
}

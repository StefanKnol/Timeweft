import type { RunSnapshot } from '@timeweft/contract';
import { KeptText } from './marks.tsx';
import { RunDetailsEditor } from './RunDetailsEditor.tsx';
import { BackupDownload } from './BackupDownload.tsx';

/**
 * "About this run": what the run is (its setting, clocks and narration), the form that changes
 * them with their history, and the backup download. These used to sit above every section, which
 * pushed each section's own content below the first screen of a phone.
 */
export function RunSection({ snapshot, readAgain }: { snapshot: RunSnapshot; readAgain: () => void }) {
  const { run } = snapshot;
  return (
    <>
      <dl className="property-list">
        <div>
          <dt>Handle</dt>
          <dd><code>{run.slug}</code></dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{run.status === 'binding' ? 'Binding: what it establishes is canon' : 'A telling: its facts stay in the run'}</dd>
        </div>
        <div>
          <dt>Setting</dt>
          <dd><KeptText text={run.setting} emptyWords="No setting written yet." /></dd>
        </div>
        <div>
          <dt>Clocks</dt>
          <dd>
            {snapshot.clocks.length === 0 ? (
              <span className="quiet">No clocks.</span>
            ) : (
              <ul className="plain-list">
                {snapshot.clocks.map((clock) => (
                  <li key={clock.id}>{clock.name}{clock.countsFrom === '' ? '' : ` (from ${clock.countsFrom})`}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt>Narrated</dt>
          <dd><KeptText text={run.register} emptyWords="Nothing said yet about how it is narrated." /></dd>
        </div>
      </dl>
      <RunDetailsEditor snapshot={snapshot} readAgain={readAgain} />
      <BackupDownload runSlug={run.slug} />
    </>
  );
}

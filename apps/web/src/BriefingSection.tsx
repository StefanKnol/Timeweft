import { useState } from 'react';
import type { Briefing } from '@timeweft/contract';
import { useCallOperation } from './calling.tsx';
import { budgetFromText, DEFAULT_BUDGET_BYTES, sizeInWords, upcomingNamesFromText } from './shaping.ts';

export function BriefingSection({ runSlug }: { runSlug: string }) {
  const callOperation = useCallOperation();
  const [upcomingText, setUpcomingText] = useState('');
  const [budgetText, setBudgetText] = useState(String(DEFAULT_BUDGET_BYTES));
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function askForBriefing() {
    const budget = budgetFromText(budgetText);
    if (!budget.ok) {
      setMessage(budget.reason);
      return;
    }
    setBusy(true);
    setMessage('');
    const outcome = await callOperation('resume_run', {
      run: runSlug,
      upcoming: upcomingNamesFromText(upcomingText),
      budgetBytes: budget.budgetBytes,
    });
    setBusy(false);
    if (outcome.kind === 'answer') setBriefing(outcome.answer);
    else if (outcome.kind === 'refusal') setMessage(outcome.refusal);
    else if (outcome.kind === 'fault') setMessage(`Something went wrong: ${outcome.fault}`);
  }

  return (
    <>
      <p>This is exactly what a chat resuming the run is told. Author-only material is never in it.</p>
      <form
        className="stacked-form"
        onSubmit={(event) => {
          event.preventDefault();
          void askForBriefing();
        }}
      >
        <label htmlFor="upcoming-names">Who and what the next scene involves (one per line, or separated by commas)</label>
        <textarea id="upcoming-names" rows={3} value={upcomingText} onChange={(event) => setUpcomingText(event.target.value)} />
        <label htmlFor="budget-bytes">Budget in bytes (2,000 to 200,000)</label>
        <input id="budget-bytes" inputMode="numeric" value={budgetText} onChange={(event) => setBudgetText(event.target.value)} />
        <button type="submit" disabled={busy}>{busy ? 'Asking…' : 'Resume run'}</button>
      </form>
      {message !== '' && <p className="refusal" role="alert">{message}</p>}
      {briefing !== null && (
        <>
          <h3>Size</h3>
          <p>{sizeInWords(briefing.bytes)} of a budget of {sizeInWords(briefing.budgetBytes)}.</p>
          <h3>Sections</h3>
          <div className="table-scroller">
            <table>
              <thead>
                <tr><th scope="col">Section</th><th scope="col">Size</th><th scope="col">Served</th><th scope="col">Left out</th><th scope="col">Fetch the rest with</th></tr>
              </thead>
              <tbody>
                {briefing.sections.map((section) => (
                  <tr key={section.name}>
                    <th scope="row">{section.name}</th>
                    <td>{section.bytes.toLocaleString('en')} bytes</td>
                    <td>{section.served}</td>
                    <td className={section.leftOut > 0 ? 'attention' : undefined}>{section.leftOut}</td>
                    <td>{section.fetchWith === '' ? 'nothing left out' : section.fetchWith}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>The text</h3>
          <pre className="briefing-text">{briefing.text}</pre>
        </>
      )}
    </>
  );
}

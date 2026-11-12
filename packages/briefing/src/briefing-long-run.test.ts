/**
 * The faults found by reading a long run's briefing as a writer would, each held here against a
 * made-up long run of the demo world shaped like that run (see generateLongRun).
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Briefing } from '@timeweft/contract';
import { CLOCK_DESCRIPTION_BYTES, SCENE_SUMMARY_BYTES, buildBriefing } from './briefing.ts';
import { LONG_RUN_POINT_OF_VIEW_ID, fact, generateLongRun, millerRun, ruling, scene } from './demo-run.ts';
import { findInRun } from './readers.ts';
import { CUT_MARKER, byteLengthOf } from './text-fitting.ts';

const LONG_RUN = generateLongRun({ seed: 417, scenes: 417 });
const POINT_OF_VIEW_NAME = LONG_RUN.entries.find((item) => item.id === LONG_RUN_POINT_OF_VIEW_ID)?.name ?? '';

function sectionTextOf(briefing: Briefing, heading: string): string {
  const start = briefing.text.indexOf(`## ${heading}\n`);
  if (start < 0) return '';
  const next = briefing.text.indexOf('\n## ', start + 3);
  return briefing.text.slice(start, next < 0 ? undefined : next + 1);
}

function sectionNamed(briefing: Briefing, name: string): Briefing['sections'][number] {
  const section = briefing.sections.find((candidate) => candidate.name === name);
  assert.ok(section, `no section named ${name}`);
  return section;
}

/** The page's entries, each as its heading and the lines under it. */
function entriesOnThePage(briefing: Briefing): Array<{ heading: string; lines: string[] }> {
  const blocks: Array<{ heading: string; lines: string[] }> = [];
  for (const line of sectionTextOf(briefing, 'On the page next').split('\n')) {
    if (line.startsWith('### ')) blocks.push({ heading: line, lines: [] });
    else if (line.length > 0) blocks.at(-1)?.lines.push(line);
  }
  return blocks;
}

describe('the main character, with no upcoming names given', () => {
  it('serves the entry with the longest trail first, at every budget from small to large', () => {
    for (const budgetBytes of [2300, 4000, 8000, 20_000, 60_000]) {
      const first = entriesOnThePage(buildBriefing(LONG_RUN, { upcoming: [], budgetBytes }))[0];
      assert.ok(first?.heading.startsWith(`### ${POINT_OF_VIEW_NAME} (`), `budget ${budgetBytes}: ${first?.heading}`);
    }
  });

  it('gives each served entry its heading, its facts and its two newest trail notes before starting the next', () => {
    for (let budgetBytes = 3000; budgetBytes <= 20_000; budgetBytes += 500) {
      const briefing = buildBriefing(LONG_RUN, { upcoming: [], budgetBytes });
      const blocks = entriesOnThePage(briefing);
      assert.ok(blocks.length >= 1);
      for (const block of blocks.slice(0, -1)) {
        const entry = LONG_RUN.entries.find((candidate) => block.heading.startsWith(`### ${candidate.name} (`));
        assert.ok(entry, block.heading);
        const trailNotes = LONG_RUN.notes.filter((item) => item.entryId === entry.id).length;
        const holdingFacts = LONG_RUN.facts.filter((item) => item.entryId === entry.id && item.untilSceneId === null).length;
        const servedTrail = block.lines.filter((line) => line.startsWith('- Trail, scene ')).length;
        const servedFacts = block.lines.filter((line) => !line.startsWith('- Trail, scene ')).length;
        assert.ok(servedTrail >= Math.min(2, trailNotes), `budget ${budgetBytes}: ${block.heading} has ${servedTrail} trail notes`);
        assert.ok(servedFacts >= Math.min(12, holdingFacts), `budget ${budgetBytes}: ${block.heading} has ${servedFacts} of ${holdingFacts} facts`);
      }
    }
  });
});

describe('a fact says since when', () => {
  it('says the scene a fact was established at, or that it held from the start, newest first', () => {
    const briefing = buildBriefing(LONG_RUN, { upcoming: [POINT_OF_VIEW_NAME], budgetBytes: 20_000 });
    const lines = entriesOnThePage(briefing)[0]?.lines.filter((line) => !line.startsWith('- Trail, scene ')) ?? [];
    assert.ok(lines.length >= 5);
    for (const line of lines) assert.match(line, /^- [^(]+ \((since scene \d+|from the start)\): /, line);
    const ages = lines.map((line) => (line.includes('(from the start)') ? 0 : Number(/since scene (\d+)/.exec(line)?.[1])));
    assert.deepEqual([...ages].sort((left, right) => right - left), ages, 'newest first');
    assert.ok(lines.some((line) => line.startsWith('- state (since scene 2): a stranger in the valley')), 'an early fact says how old it is');
    assert.ok(lines.at(-1)?.includes('(from the start)'), 'a fact from the start comes last');
  });
});

describe('the rulings that bear', () => {
  it('serves the author\'s standing instructions about the telling before the world\'s coined facts', () => {
    const rulings = sectionTextOf(buildBriefing(LONG_RUN, { upcoming: [], budgetBytes: 20_000 }), 'Rulings that bear');
    const numbers = [...rulings.matchAll(/^\*\*Ruling (\d+)\*\*/gm)].map((match) => Number(match[1]));
    const served = numbers.map((number) => LONG_RUN.rulings.find((item) => item.number === number));
    assert.ok(served.length > 10);
    assert.deepEqual(served.slice(0, 2).map((item) => item?.topics.includes('narration')), [true, true], 'the narration rulings lead');
    const firstWorld = served.findIndex((item) => item?.scope === 'world');
    const runRulings = LONG_RUN.rulings.filter((item) => item.scope === 'run').length;
    assert.ok(firstWorld < 0 || firstWorld >= runRulings, 'no world ruling before every run ruling');
  });

  it('holds about a fifth of the budget of its own when the page before it is cut', () => {
    // With many names asked for the page leaves things out and passes no room on, so what the
    // rulings serve is their own share.
    const names = LONG_RUN.entries.slice(0, 21).map((item) => item.name);
    const budgetBytes = 8000;
    const briefing = buildBriefing(LONG_RUN, { upcoming: names, budgetBytes });
    assert.ok(sectionNamed(briefing, 'On the page next').leftOut > 0);
    const rulings = sectionNamed(briefing, 'Rulings that bear').bytes;
    assert.ok(rulings >= budgetBytes * 0.15, `${rulings} bytes of ${budgetBytes}`);
  });

  it('serves the first ruling whenever the whole has room for it, even when it is long and the budget small', () => {
    const snapshot = millerRun();
    snapshot.rulings = [ruling({ id: 'ruling-long', number: 1, text: 'The miller tells no lies at the ford. '.repeat(17), topics: ['narration'] })];
    for (let factIndex = 0; factIndex < 40; factIndex += 1) {
      snapshot.facts.push(fact({ id: `fact-habit-${factIndex}`, entryId: 'entry-keeper', property: `habit ${factIndex}`, value: 'mends rope by the fire', fromSceneId: 'scene-3' }));
    }
    for (let number = 4; number <= 30; number += 1) snapshot.scenes.push(scene({ id: `scene-${number}`, number, summary: 'Short.' }));
    for (let budgetBytes = 2200; budgetBytes <= 2600; budgetBytes += 10) {
      const briefing = buildBriefing(snapshot, { upcoming: ['Bram'], budgetBytes });
      assert.equal(sectionNamed(briefing, 'Rulings that bear').served, 1, `budget ${budgetBytes}`);
      assert.ok(briefing.bytes <= budgetBytes);
    }
  });
});

describe('a clock with a long description', () => {
  it('cuts the description at a sentence to about two hundred bytes, marks it, and keeps every reading whole', () => {
    const clocks = sectionTextOf(buildBriefing(LONG_RUN, { upcoming: [], budgetBytes: 20_000 }), 'The clocks');
    const long = clocks.split('\n').find((line) => line.startsWith('- Days since the mill burned: '));
    assert.ok(long, clocks);
    assert.ok(long.startsWith('- Days since the mill burned: 417, dusk, at scene 417. Counts from: '), long);
    assert.ok(long.endsWith(`.${CUT_MARKER}`), 'cut after a sentence and marked');
    assert.ok(byteLengthOf(long) <= byteLengthOf('- Days since the mill burned: 417, dusk, at scene 417. Counts from: ') + CLOCK_DESCRIPTION_BYTES);
    assert.ok(clocks.includes('- Weeks of the harvest: no reading yet. Counts from: the first sheaf cut\n'), 'the other clock is still there');
  });
});

describe('journeys with no scene', () => {
  it('are found by find, as notes saying they are journeys, never from a struck take', () => {
    const snapshot = millerRun();
    snapshot.legs.push({ id: 'leg-nowhere', runId: 'run-demo', fromPlace: 'the reed bed', toPlace: 'the weir', duration: 'an hour', note: 'by punt', sceneId: null, createdAt: snapshot.run.createdAt });
    const found = findInRun(snapshot, 'weir', 100);
    assert.deepEqual(found, [{ kind: 'note', text: 'Journey: the reed bed to the weir: an hour (by punt)', entryName: null, sceneNumber: null }]);
    assert.deepEqual(findInRun(snapshot, 'swept downstream', 100), []);
  });

  it('name find as what fetches the journeys left out', () => {
    const briefing = buildBriefing(LONG_RUN, { upcoming: [], budgetBytes: 4000 });
    const journeys = sectionNamed(briefing, 'Journeys already travelled');
    assert.ok(journeys.leftOut > 0);
    assert.match(journeys.fetchWith, /\bfind\b/);
  });
});

describe('the last scenes', () => {
  it('serves a long summary as its first sentences, marked, so that more scenes fit', () => {
    const briefing = buildBriefing(LONG_RUN, { upcoming: [], budgetBytes: 60_000 });
    const lines = sectionTextOf(briefing, 'The last scenes').split('\n').filter((line) => line.startsWith('- Scene '));
    assert.ok(lines.length >= 3);
    for (const line of lines) {
      const summary = line.slice(line.indexOf('", day ') + 1).replace(/^[^:]*: /, '');
      assert.ok(byteLengthOf(summary) <= SCENE_SUMMARY_BYTES, line);
    }
    assert.ok(lines.some((line) => line.endsWith(CUT_MARKER)), 'a long summary is marked as cut');
    assert.ok(sectionNamed(briefing, 'The last scenes').served >= 6, `${sectionNamed(briefing, 'The last scenes').served} scenes`);
  });
});

describe('the guarantees, on the long run', () => {
  it('never passes the budget, always draws the first three sections, never cuts a ruling, and gives the same bytes twice', () => {
    for (let budgetBytes = 2000; budgetBytes <= 80_000; budgetBytes += 1500) {
      for (const upcoming of [[], [POINT_OF_VIEW_NAME, 'a stranger at the ford']]) {
        const briefing = buildBriefing(LONG_RUN, { upcoming, budgetBytes });
        assert.ok(byteLengthOf(briefing.text) <= budgetBytes, `budget ${budgetBytes}`);
        for (const heading of ['## The run\n', '## The clocks\n', '## Where things stand\n']) assert.ok(briefing.text.includes(heading), `budget ${budgetBytes}: ${heading}`);
        for (const item of LONG_RUN.rulings) {
          // By its heading: the made-up world rulings share their opening words.
          const at = briefing.text.indexOf(`**Ruling ${item.number}**`);
          if (at >= 0) assert.ok(briefing.text.slice(at).split('\n')[1] === item.text, `budget ${budgetBytes}: ruling ${item.number} cut`);
        }
        assert.equal(buildBriefing(LONG_RUN, { upcoming, budgetBytes }).text, briefing.text);
      }
    }
  });
});

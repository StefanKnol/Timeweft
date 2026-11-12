import { strict as assert } from 'node:assert';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';
import type { Briefing, RunSnapshot } from '@timeweft/contract';
import { buildBriefing } from './briefing.ts';
import { entry, fact, generateRun, leg, millerRun, note, ruling, scene } from './demo-run.ts';
import type { GeneratedRunOptions } from './demo-run.ts';
import { rulingsBearingOn, standingScenesOf, threadsOpenFor } from './readers.ts';
import { CUT_MARKER } from './text-fitting.ts';

const BUDGETS = [2000, 2100, 2600, 3300, 5000, 8000, 13_000, 20_000, 34_000, 55_000, 89_000, 144_000, 200_000];

const SIZES: Array<Omit<GeneratedRunOptions, 'seed'>> = [
  { scenes: 0, entries: 0, factsPerEntry: 0, notesPerEntry: 0, rulings: 0, threads: 0, clocks: 0, waypoints: 0 },
  { scenes: 1, entries: 1, factsPerEntry: 1, notesPerEntry: 1, rulings: 1, threads: 1, clocks: 1, waypoints: 1, legs: 1 },
  { scenes: 12, entries: 8, factsPerEntry: 6, notesPerEntry: 5, rulings: 10, threads: 6, clocks: 2, waypoints: 3, legs: 4 },
  { scenes: 80, entries: 40, factsPerEntry: 20, notesPerEntry: 15, rulings: 60, threads: 30, clocks: 4, waypoints: 8, legs: 30 },
  { scenes: 300, entries: 90, factsPerEntry: 40, notesPerEntry: 30, rulings: 200, threads: 80, clocks: 12, waypoints: 40, legs: 120 },
];

const HUGE_FIELDS = ['register', 'situation', 'title', 'summary', 'fact', 'ruling'] as const;

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

/** Names that some generated entries carry, and two that nothing does. */
function upcomingFor(snapshot: RunSnapshot, seed: number): string[] {
  const names = snapshot.entries.filter((_, entryIndex) => (entryIndex + seed) % 7 === 0).slice(0, 6).map((entry) => entry.name);
  return seed % 3 === 0 ? [] : [...names, 'a stranger at the ford', '  '];
}

function linesCutShort(snapshot: RunSnapshot, upcoming: string[], budgetBytes: number): string[] {
  return buildBriefing(snapshot, { upcoming, budgetBytes }).text.split('\n').filter((line) => line.endsWith(CUT_MARKER));
}

/** Every snapshot and request the property tests walk through. */
interface Case { label: string; snapshot: RunSnapshot; upcoming: string[]; budgetBytes: number }
let everyCaseMade: Case[] | null = null;
function everyCase(): Case[] {
  everyCaseMade ??= [...makeEveryCase()];
  return everyCaseMade;
}
function* makeEveryCase(): Generator<Case> {
  let seed = 1;
  for (const size of SIZES) {
    for (const hugeField of [undefined, ...HUGE_FIELDS]) {
      if (hugeField !== undefined && size.scenes === 0) continue;
      seed += 1;
      const options: GeneratedRunOptions = { ...size, seed, ...(hugeField ? { hugeField } : {}) };
      const snapshot = generateRun(options);
      for (const budgetBytes of BUDGETS) {
        yield { label: `seed ${seed}, ${size.scenes} scenes, huge ${hugeField ?? 'none'}, budget ${budgetBytes}`, snapshot, upcoming: upcomingFor(snapshot, seed), budgetBytes };
      }
    }
  }
}

describe('the budget', () => {
  it('is never exceeded, across generated runs of many sizes and budgets from 2,000 to 200,000 bytes', () => {
    let cases = 0;
    for (const { label, snapshot, upcoming, budgetBytes } of everyCase()) {
      const briefing = buildBriefing(snapshot, { upcoming, budgetBytes });
      const measured = Buffer.byteLength(briefing.text, 'utf8');
      assert.ok(measured <= budgetBytes, `${label}: ${measured} bytes`);
      assert.equal(briefing.bytes, measured, label);
      assert.equal(briefing.budgetBytes, budgetBytes, label);
      for (const line of linesCutShort(snapshot, upcoming, budgetBytes)) {
        assert.doesNotMatch(line.slice(0, -CUT_MARKER.length), /(:|:\*\*|^)\s*$/, `${label}: a cut kept nothing but a label: ${line}`);
      }
      cases += 1;
    }
    assert.ok(cases > 300);
  });

  it('always draws the run, the clocks and where things stand', () => {
    for (const { label, snapshot, upcoming, budgetBytes } of everyCase()) {
      const text = buildBriefing(snapshot, { upcoming, budgetBytes }).text;
      for (const heading of ['## The run\n', '## The clocks\n', '## Where things stand\n']) {
        assert.ok(text.includes(heading), `${label}: ${heading.trim()} missing`);
      }
      assert.ok(text.includes('**Title:**'), `${label}: no title`);
    }
  });

  it('ends with the list of what was left out', () => {
    for (const { label, snapshot, upcoming, budgetBytes } of everyCase()) {
      const briefing = buildBriefing(snapshot, { upcoming, budgetBytes });
      const listAt = briefing.text.lastIndexOf('## Left out, and how to fetch it\n');
      assert.ok(listAt > 0, `${label}: no closing list`);
      const list = briefing.text.slice(listAt);
      assert.ok(!list.includes(CUT_MARKER) && briefing.text.endsWith('\n'), `${label}: the closing list was cut`);
      for (const section of briefing.sections) {
        if (section.leftOut > 0) {
          assert.ok(list.includes(`- ${section.name}: ${section.leftOut} left out`), `${label}: ${section.name} not in the list`);
          assert.ok(list.includes(section.fetchWith) && section.fetchWith.length > 0, `${label}: ${section.name} says no way to fetch it`);
        }
      }
    }
  });

  it('cuts one field larger than the whole budget at a sentence or a word, and marks it', () => {
    for (const hugeField of ['register', 'situation', 'title'] as const) {
      const snapshot = generateRun({ scenes: 5, entries: 3, factsPerEntry: 2, notesPerEntry: 2, rulings: 2, threads: 2, clocks: 1, waypoints: 1, seed: 77, hugeField, hugeFieldBytes: 400_000 });
      const briefing = buildBriefing(snapshot, { upcoming: [], budgetBytes: 2000 });
      assert.ok(briefing.bytes <= 2000, hugeField);
      const original = hugeField === 'register' ? snapshot.run.register.trim()
        : hugeField === 'title' ? snapshot.run.title.replace(/\s+/g, ' ').trim()
          : (standingScenesOf(snapshot).at(-1)?.situationAfter ?? '').trim();
      const line = briefing.text.split('\n').find((candidate) => candidate.endsWith(CUT_MARKER) && original.startsWith(candidate.replace('**Title:** ', '').slice(0, 30)));
      assert.ok(line, `${hugeField}: the field is not served cut and marked`);
      const kept = line.replace('**Title:** ', '').slice(0, -CUT_MARKER.length);
      assert.ok(original.startsWith(kept), `${hugeField}: what is kept is the start of the field`);
      assert.match(original.charAt(kept.length), /\s/, `${hugeField}: cut inside a word`);
    }
  });

  it('cuts a register larger than its share, even when the budget is large', () => {
    const snapshot = generateRun({ scenes: 3, entries: 1, factsPerEntry: 1, notesPerEntry: 1, rulings: 1, threads: 1, clocks: 1, waypoints: 1, seed: 5, hugeField: 'register', hugeFieldBytes: 100_000 });
    const briefing = buildBriefing(snapshot, { upcoming: [], budgetBytes: 200_000 });
    const runSection = sectionTextOf(briefing, 'The run');
    assert.ok(runSection.includes(CUT_MARKER), 'the register is cut and marked');
    assert.ok(Buffer.byteLength(runSection) < 200_000 * 0.2);
    assert.ok(briefing.text.includes('- The run: 1 cut short.'));
  });

  it('gives room a later section did not use back to an earlier one that was cut', () => {
    const snapshot = generateRun({ scenes: 2, entries: 0, factsPerEntry: 0, notesPerEntry: 0, rulings: 0, threads: 0, clocks: 0, waypoints: 0, seed: 8, hugeField: 'situation' });
    const briefing = buildBriefing(snapshot, { upcoming: [], budgetBytes: 20_000 });
    assert.ok(sectionNamed(briefing, 'Where things stand').bytes > 15_000, 'the situation takes the room nobody else needed');
  });

  it('passes room an earlier section did not use on to a later one', () => {
    const snapshot = generateRun({ scenes: 2, entries: 0, factsPerEntry: 0, notesPerEntry: 0, rulings: 0, threads: 0, clocks: 0, waypoints: 0, seed: 8, hugeField: 'summary' });
    const briefing = buildBriefing(snapshot, { upcoming: [], budgetBytes: 20_000 });
    assert.ok(sectionNamed(briefing, 'The last scenes').bytes > 15_000, 'the last scenes take the room nobody else needed');
  });

  it('serves a short register whole', () => {
    const briefing = buildBriefing(millerRun(), { upcoming: [], budgetBytes: 2000 });
    assert.ok(briefing.text.includes('Plain past tense. Close third person on the miller.'));
  });
});

describe('what the briefing never serves', () => {
  it('never serves a closed fact or anything from a struck scene', () => {
    for (const { label, snapshot, upcoming, budgetBytes } of everyCase()) {
      if (budgetBytes < 50_000) continue;
      const text = buildBriefing(snapshot, { upcoming, budgetBytes }).text;
      assert.ok(!text.includes('CLOSEDVALUE'), `${label}: a closed fact was served`);
      assert.ok(!text.includes('STRUCKTEXT'), `${label}: a struck scene was served`);
    }
  });

  it('never cuts a ruling: each is served whole or not at all', () => {
    for (const { label, snapshot, upcoming, budgetBytes } of everyCase()) {
      const text = buildBriefing(snapshot, { upcoming, budgetBytes }).text;
      for (const ruling of snapshot.rulings) {
        const start = ruling.text.slice(0, 40);
        if (text.includes(start)) assert.ok(text.includes(ruling.text), `${label}: ruling ${ruling.number} was cut`);
      }
    }
  });

  it('never serves a withdrawn ruling', () => {
    const text = buildBriefing(millerRun(), { upcoming: [], budgetBytes: 20_000 }).text;
    assert.ok(!text.includes('No talk of the flood at meals.'));
    assert.ok(!text.includes('The lantern was lost.'));
  });

  it('never serves a reached waypoint, nor a closed thread', () => {
    const text = buildBriefing(millerRun(), { upcoming: [], budgetBytes: 20_000 }).text;
    assert.ok(text.includes('The autumn fair at the ford.'));
    assert.ok(!text.includes('The ferry keeper is taken in.'));
    assert.ok(!text.includes('Whose lantern is it?'));
  });
});

describe('the sections', () => {
  it('says the clocks at the newest standing scene that carries a reading', () => {
    const text = buildBriefing(millerRun(), { upcoming: [], budgetBytes: 20_000 }).text;
    assert.ok(text.includes('- Days since the flood (the night the river rose): 3, dusk, at scene 2.'));
    assert.ok(text.includes('- Days at the mill (the miller taking the ferry keeper in): 1, at scene 3.'));
  });

  it('says where things stand from the newest standing scene', () => {
    const where = sectionTextOf(buildBriefing(millerRun(), { upcoming: [], budgetBytes: 20_000 }), 'Where things stand');
    assert.ok(where.includes('Scene 3, "The mill", day 3.'));
    assert.ok(where.includes('The ferry keeper sleeps in the mill loft.'));
  });

  it('serves each upcoming entry with what holds now and its latest trail', () => {
    const page = sectionTextOf(buildBriefing(millerRun(), { upcoming: ['the ferry keeper'], budgetBytes: 20_000 }), 'On the page next');
    assert.ok(page.includes('### Bram (person, he), also the ferry keeper'));
    assert.ok(page.includes('- where: in the mill loft (The mill)'));
    assert.ok(page.includes('- standing: grateful to the miller (Wenna the miller)'));
    assert.ok(!page.includes('- where: at the ford'), 'the closed fact is history, not the present');
    assert.ok(page.includes('- Trail, scene 3: Climbed to the loft to sleep.'));
    assert.ok(!page.includes('Dropped the lantern'), 'a note from a struck scene is never served');
  });

  it('says a name that does not resolve is new, and a name two answer to says both', () => {
    const page = sectionTextOf(buildBriefing(millerRun(), { upcoming: ['the baker', 'the boat'], budgetBytes: 20_000 }), 'On the page next');
    assert.ok(page.includes('### the baker\nNot in the store: it would be new.'));
    assert.ok(page.includes('Ferry (item)') && page.includes('The old raft (item)'));
  });

  it('uses the newest scene\'s place, facts and notes when nothing upcoming is named', () => {
    const page = sectionTextOf(buildBriefing(millerRun(), { upcoming: [], budgetBytes: 20_000 }), 'On the page next');
    const order = ['### The mill', '### Bram', '### The lantern'].map((heading) => page.indexOf(heading));
    assert.ok(order.every((at) => at >= 0), 'the place, the keeper and the lantern are all there');
    assert.deepEqual([...order].sort((left, right) => left - right), order, 'the place comes first');
    assert.ok(!page.includes('### Wenna the miller'), 'the newest scene did not touch the miller');
  });

  it('serves rulings about the upcoming entries first, then narration', () => {
    const rulings = sectionTextOf(buildBriefing(millerRun(), { upcoming: ['Bram'], budgetBytes: 20_000 }), 'Rulings that bear');
    const aboutKeeper = rulings.indexOf('The ferry keeper never swims.');
    const narration = rulings.indexOf('Tell it in the past tense, close on the miller.');
    assert.ok(aboutKeeper >= 0 && narration > aboutKeeper);
  });

  it('serves threads touching the upcoming entries first', () => {
    const threads = sectionTextOf(buildBriefing(millerRun(), { upcoming: ['Wenna the miller'], budgetBytes: 20_000 }), 'Open threads');
    const flour = threads.indexOf('Will the flour last the winter?');
    const rope = threads.indexOf('Who cut the ferry rope?');
    assert.ok(flour >= 0 && rope > flour);
    assert.ok(threads.includes('- Thread thread-flour: Will the flour'), 'a thread carries its id first, so a save can close it');
  });

  it('serves the last scenes newest first and never the struck take', () => {
    const scenes = sectionTextOf(buildBriefing(millerRun(), { upcoming: [], budgetBytes: 20_000 }), 'The last scenes');
    assert.ok(scenes.indexOf('Scene 3,') < scenes.indexOf('Scene 2,') && scenes.indexOf('Scene 2,') < scenes.indexOf('Scene 1 (starred),'));
    assert.ok(!scenes.includes('first take'));
  });

  it('prefers starred scenes further back when room runs short', () => {
    const snapshot = generateRun({ scenes: 120, entries: 0, factsPerEntry: 0, notesPerEntry: 0, rulings: 0, threads: 0, clocks: 0, waypoints: 0, seed: 9 });
    const briefing = buildBriefing(snapshot, { upcoming: [], budgetBytes: 6000 });
    const scenesSection = sectionTextOf(briefing, 'The last scenes');
    const servedNumbers = [...scenesSection.matchAll(/^- Scene (\d+)/gm)].map((match) => Number(match[1]));
    const standing = standingScenesOf(snapshot);
    const olderServed = servedNumbers.filter((number) => number <= (standing[standing.length - 4]?.number ?? 0));
    const starredNumbers = new Set(standing.filter((scene) => scene.starred).map((scene) => scene.number));
    assert.ok(olderServed.length > 0, 'something further back was served');
    const firstUnstarredLeftOut = standing.slice(0, -3).reverse().find((scene) => !servedNumbers.includes(scene.number) && !scene.starred);
    const starredLeftOut = standing.slice(0, -3).filter((scene) => scene.starred && !servedNumbers.includes(scene.number));
    for (const number of olderServed) {
      if (!starredNumbers.has(number)) assert.equal(starredLeftOut.length, 0, `unstarred scene ${number} served while a starred one was left out`);
    }
    assert.ok(firstUnstarredLeftOut || starredLeftOut.length === 0);
  });

  it('never lets a small unstarred scene in ahead of a starred one that did not fit', () => {
    const snapshot = generateRun({ scenes: 0, entries: 0, factsPerEntry: 0, notesPerEntry: 0, rulings: 0, threads: 0, clocks: 0, waypoints: 0, seed: 4 });
    snapshot.scenes = [
      scene({ id: 'scene-1', number: 1, summary: 'Short.' }),
      scene({ id: 'scene-2', number: 2, starred: true, title: `The long night at the ford ${'and the mill '.repeat(8)}`, summary: 'The miller and the ferry keeper wait out the storm. '.repeat(8) }),
      ...[3, 4, 5].map((number) => scene({ id: `scene-${number}`, number, summary: 'The ferry crosses and comes back again. '.repeat(25) })),
    ];
    let unfairBudgets = 0;
    for (let budgetBytes = 2000; budgetBytes <= 12_000; budgetBytes += 1) {
      const served = sectionTextOf(buildBriefing(snapshot, { upcoming: [], budgetBytes }), 'The last scenes');
      if (served.includes('- Scene 1,') && !served.includes('- Scene 2 (starred)')) unfairBudgets += 1;
    }
    assert.equal(unfairBudgets, 0);
  });

  it('counts what it served and left out, item by item', () => {
    for (const { label, snapshot, upcoming, budgetBytes } of everyCase()) {
      const briefing = buildBriefing(snapshot, { upcoming, budgetBytes });
      const rulingsInForce = rulingsBearingOn(snapshot, { aboutEntryIds: [] });
      const rulings = sectionNamed(briefing, 'Rulings that bear');
      assert.equal(rulings.served + rulings.leftOut, rulingsInForce.length, `${label}: rulings`);
      assert.equal(rulings.served, rulingsInForce.filter((ruling) => briefing.text.includes(ruling.text)).length, `${label}: rulings served`);
      const scenes = sectionNamed(briefing, 'The last scenes');
      assert.equal(scenes.served + scenes.leftOut, standingScenesOf(snapshot).length, `${label}: scenes`);
      assert.equal(scenes.served, [...sectionTextOf(briefing, 'The last scenes').matchAll(/^- Scene \d+/gm)].length, `${label}: scenes served`);
      const threads = sectionNamed(briefing, 'Open threads');
      assert.equal(threads.served + threads.leftOut, threadsOpenFor(snapshot, { aboutEntryIds: [], includeClosed: false }).length, `${label}: threads`);
      assert.equal(threads.served, [...sectionTextOf(briefing, 'Open threads').matchAll(/^- Thread thread-\d+: /gm)].length, `${label}: threads served`);
      const journeys = sectionNamed(briefing, 'Journeys already travelled');
      const servableLegs = snapshot.legs.filter((item) => !(item.sceneId ?? '').endsWith('-struck'));
      assert.equal(journeys.served + journeys.leftOut, servableLegs.length, `${label}: journeys`);
      assert.equal(journeys.served, [...sectionTextOf(briefing, 'Journeys already travelled').matchAll(/^- .+ to .+: /gm)].length, `${label}: journeys served`);
      const clocks = sectionNamed(briefing, 'The clocks');
      assert.equal(clocks.served + clocks.leftOut, snapshot.clocks.length, `${label}: clocks`);
      for (const section of briefing.sections) {
        if (section.leftOut > 0) assert.ok(section.fetchWith.length > 0, `${label}: ${section.name} left out with no way to fetch it`);
        const listed = briefing.text.slice(briefing.text.lastIndexOf('## Left out')).includes(`- ${section.name}: `);
        assert.equal(listed, section.fetchWith.length > 0, `${label}: ${section.name} listed exactly when something is missing`);
      }
    }
  });

  it('names the fetching operation for every section that left something out', () => {
    const snapshot = generateRun({ scenes: 200, entries: 50, factsPerEntry: 20, notesPerEntry: 10, rulings: 80, threads: 40, clocks: 30, waypoints: 30, seed: 11 });
    const briefing = buildBriefing(snapshot, { upcoming: snapshot.entries.slice(0, 5).map((entry) => entry.name), budgetBytes: 3000 });
    const wanted: Record<string, RegExp> = {
      'On the page next': /look_up/, 'Rulings that bear': /list_rulings/, 'Open threads': /list_threads/, 'The last scenes': /list_scenes/,
    };
    for (const [name, operation] of Object.entries(wanted)) {
      const section = sectionNamed(briefing, name);
      assert.ok(section.leftOut > 0, `${name} left something out at this size`);
      assert.match(section.fetchWith, operation);
    }
  });

  it('has nothing to leave out of a small run with room to spare', () => {
    const briefing = buildBriefing(millerRun(), { upcoming: [], budgetBytes: 20_000 });
    assert.ok(briefing.sections.every((section) => section.leftOut === 0 && section.fetchWith === ''));
    assert.ok(briefing.text.endsWith('## Left out, and how to fetch it\n- Nothing was left out.\n'));
  });

  it('draws an empty run without failing', () => {
    const snapshot = generateRun({ scenes: 0, entries: 0, factsPerEntry: 0, notesPerEntry: 0, rulings: 0, threads: 0, clocks: 0, waypoints: 0, seed: 3 });
    const text = buildBriefing(snapshot, { upcoming: [], budgetBytes: 2000 }).text;
    assert.ok(text.includes('No scene has been saved yet'));
    assert.ok(text.includes('No clocks are kept.'));
  });
});

describe('determinism', () => {
  it('gives the same bytes for the same snapshot and request', () => {
    for (const budgetBytes of [2000, 9000, 60_000]) {
      const first = buildBriefing(generateRun({ scenes: 60, entries: 30, factsPerEntry: 10, notesPerEntry: 8, rulings: 30, threads: 20, clocks: 3, waypoints: 5, seed: 42 }), { upcoming: ['ford keeper 3'], budgetBytes });
      const second = buildBriefing(generateRun({ scenes: 60, entries: 30, factsPerEntry: 10, notesPerEntry: 8, rulings: 30, threads: 20, clocks: 3, waypoints: 5, seed: 42 }), { upcoming: ['ford keeper 3'], budgetBytes });
      assert.equal(first.text, second.text);
      assert.deepEqual(first.sections, second.sections);
    }
  });
});

describe('speed', () => {
  it('briefs a 500-scene, 100-entry run with 20,000 facts and notes into 20,000 bytes in well under a second', () => {
    const snapshot = generateRun({ scenes: 500, entries: 100, factsPerEntry: 120, notesPerEntry: 80, rulings: 300, threads: 150, clocks: 6, waypoints: 20, seed: 500 });
    assert.ok(snapshot.facts.length + snapshot.notes.length >= 19_000);
    const started = performance.now();
    const briefing = buildBriefing(snapshot, { upcoming: snapshot.entries.slice(0, 8).map((entry) => entry.name), budgetBytes: 20_000 });
    const elapsed = performance.now() - started;
    assert.ok(briefing.bytes <= 20_000);
    assert.ok(briefing.bytes > 15_000, 'the room is used');
    assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)} ms`);
  });
});

describe('the faults found on review', () => {
  it('serves the journeys already travelled between the open threads and the last scenes', () => {
    const briefing = buildBriefing(millerRun(), { upcoming: [], budgetBytes: 20_000 });
    const names = briefing.sections.map((section) => section.name);
    assert.equal(names.indexOf('Journeys already travelled'), names.indexOf('Open threads') + 1);
    assert.equal(names.indexOf('The last scenes'), names.indexOf('Journeys already travelled') + 1);
    const text = briefing.text;
    assert.ok(text.indexOf('## Open threads\n') < text.indexOf('## Journeys already travelled\n'));
    assert.ok(text.indexOf('## Journeys already travelled\n') < text.indexOf('## The last scenes\n'));
    const journeys = sectionTextOf(briefing, 'Journeys already travelled');
    const newest = journeys.indexOf('- The ford to The mill: half a day on foot (carrying the ferry keeper)\n');
    const older = journeys.indexOf('- the far bank to the market town: two days by cart\n');
    assert.ok(newest >= 0 && older > newest, 'the newest first, and a note in brackets only where there is one');
    assert.ok(!journeys.includes('an hour by raft'), 'never a journey from a struck take');
  });

  it('serves the journeys touching the upcoming places first, by name or another name, case-blind', () => {
    const byName = sectionTextOf(buildBriefing(millerRun(), { upcoming: ['THE MARKET TOWN'], budgetBytes: 20_000 }), 'Journeys already travelled');
    assert.ok(byName.indexOf('the market town') < byName.indexOf('The mill:'), 'an older journey to a place asked for leads');
    const snapshot = millerRun();
    snapshot.legs.push(leg({ id: 'leg-to-miller', fromPlace: 'the reeds', toPlace: 'The Miller', duration: 'an hour', sceneId: 'scene-1', createdAt: momentOf(snapshot) }));
    const byOtherName = sectionTextOf(buildBriefing(snapshot, { upcoming: ['Wenna the miller'], budgetBytes: 20_000 }), 'Journeys already travelled');
    assert.ok(byOtherName.startsWith('## Journeys already travelled\n- the reeds to The Miller: an hour\n'), byOtherName);
  });

  it('says how many journeys it left out and that read_scene fetches them', () => {
    const snapshot = generateRun({ scenes: 40, entries: 10, factsPerEntry: 3, notesPerEntry: 2, rulings: 3, threads: 3, clocks: 1, waypoints: 1, legs: 200, seed: 31 });
    const briefing = buildBriefing(snapshot, { upcoming: [], budgetBytes: 4000 });
    const journeys = sectionNamed(briefing, 'Journeys already travelled');
    assert.ok(journeys.served > 0 && journeys.leftOut > 0);
    assert.match(journeys.fetchWith, /read_scene/);
  });

  it('says that list_runs carries a register cut short, not that a larger budget would', () => {
    const snapshot = generateRun({ scenes: 3, entries: 1, factsPerEntry: 1, notesPerEntry: 1, rulings: 1, threads: 1, clocks: 1, waypoints: 1, seed: 5, hugeField: 'register', hugeFieldBytes: 400_000 });
    const runSection = sectionNamed(buildBriefing(snapshot, { upcoming: [], budgetBytes: 200_000 }), 'The run');
    assert.match(runSection.fetchWith, /list_runs/);
    assert.doesNotMatch(runSection.fetchWith, /larger budgetBytes/);
  });

  it('never cuts a scene line inside its title, even where the title holds a colon', () => {
    const snapshot = generateRun({ scenes: 0, entries: 0, factsPerEntry: 0, notesPerEntry: 0, rulings: 0, threads: 0, clocks: 0, waypoints: 0, seed: 4 });
    const title = 'The mill: a long night by the water wheel and the grinding stones and the reeds';
    snapshot.scenes = [1, 2, 3, 4].map((number) => scene({
      id: `scene-${number}`, number, title,
      summary: 'The miller and the ferry keeper wait out the storm by the wheel. '.repeat(30),
    }));
    let cutLines = 0;
    for (let budgetBytes = 2000; budgetBytes <= 9000; budgetBytes += 3) {
      for (const line of buildBriefing(snapshot, { upcoming: [], budgetBytes }).text.split('\n')) {
        if (!line.startsWith('- Scene') || !line.endsWith(CUT_MARKER)) continue;
        cutLines += 1;
        assert.ok(line.includes(`"${title}", day `), `budget ${budgetBytes}: ${line}`);
      }
    }
    assert.ok(cutLines > 0);
  });

  it('serves the newest trail notes of an entry with many facts ahead of its later facts', () => {
    const snapshot = millerRun();
    for (let factIndex = 0; factIndex < 80; factIndex += 1) {
      snapshot.facts.push(fact({ id: `fact-many-${factIndex}`, entryId: 'entry-keeper', property: `habit ${String(factIndex).padStart(2, '0')}`,
        value: 'mends rope by the fire and hums while the river runs', fromSceneId: 'scene-2' }));
    }
    const briefing = buildBriefing(snapshot, { upcoming: ['Bram', 'Wenna the miller'], budgetBytes: 5000 });
    const page = sectionTextOf(briefing, 'On the page next');
    assert.ok(sectionNamed(briefing, 'On the page next').leftOut > 0, 'not every fact fits at this size');
    assert.ok(page.includes('- Trail, scene 3: Climbed to the loft to sleep.'), page);
    assert.ok(page.includes('- Trail, scene 2: Mended the ferry rope.'));
    assert.ok(page.includes('- who: grinds grain for the valley'), 'the other name is not starved');
  });

  it('serves a ruling before any old scene summary whenever the budget allows one', () => {
    const snapshot = generateRun({ scenes: 30, entries: 6, factsPerEntry: 4, notesPerEntry: 2, rulings: 0, threads: 0, clocks: 1, waypoints: 1, seed: 17 });
    snapshot.rulings = [1, 2, 3, 4, 5].map((number) => ruling({ id: `ruling-${number}`, number, text: `Ruling ${number}: the miller sings at dawn. ${'The ferry keeper hums along by the wheel. '.repeat(5)}` }));
    for (const item of snapshot.scenes) item.summary = 'The ferry crosses the ford and comes back with sacks of grain for the mill. '.repeat(4);
    let budgetsChecked = 0;
    for (let budgetBytes = 2000; budgetBytes <= 6000; budgetBytes += 25) {
      const briefing = buildBriefing(snapshot, { upcoming: [], budgetBytes });
      if (sectionNamed(briefing, 'The last scenes').served === 0) continue;
      budgetsChecked += 1;
      assert.ok(sectionNamed(briefing, 'Rulings that bear').served > 0, `budget ${budgetBytes}: scenes served and no ruling`);
    }
    assert.ok(budgetsChecked > 0);
  });
});

describe('room a section that left something out did not use', () => {
  it('goes back to a more important section that was cut, not on to a less important one', () => {
    const withoutRulings = millerRun();
    withoutRulings.rulings = [];
    for (let factIndex = 0; factIndex < 120; factIndex += 1) {
      withoutRulings.facts.push(fact({ id: `fact-many-${factIndex}`, entryId: 'entry-keeper', property: `habit ${String(factIndex).padStart(3, '0')}`,
        value: 'mends rope by the fire and hums while the river runs', fromSceneId: 'scene-2' }));
    }
    for (let number = 4; number <= 60; number += 1) {
      withoutRulings.scenes.push(scene({ id: `scene-${number}`, number, summary: 'The ferry crosses the ford and comes back again. '.repeat(3) }));
    }
    // One ruling too long for its share: the section leaves it out and uses almost none of its room.
    const withALongRuling = structuredClone(withoutRulings);
    withALongRuling.rulings = [ruling({ id: 'ruling-long', number: 1, text: 'The miller never lies. '.repeat(300) })];
    for (const budgetBytes of [5000, 6500, 8000]) {
      const plain = buildBriefing(withoutRulings, { upcoming: ['Bram'], budgetBytes });
      const kept = buildBriefing(withALongRuling, { upcoming: ['Bram'], budgetBytes });
      assert.equal(sectionNamed(kept, 'Rulings that bear').served, 0, `${budgetBytes}: the ruling does not fit`);
      assert.ok(sectionNamed(kept, 'On the page next').leftOut > 0, `${budgetBytes}: the page is still cut`);
      assert.ok(sectionNamed(kept, 'On the page next').served > sectionNamed(plain, 'On the page next').served,
        `${budgetBytes}: the rulings' room went to the page ahead of it`);
    }
  });
});

function momentOf(snapshot: RunSnapshot): string {
  return snapshot.run.createdAt;
}

/**
 * The author's run page reads the run without the scenes' prose: `read_run` answers an outline,
 * and the two author reads beside it, `read_scene_text` and `search_scenes`, fetch and search the
 * prose. All three are the author's alone: a story caller is refused before any of them runs, and
 * none is an MCP tool. The other callers of the whole snapshot (resume, export) still read it whole.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { RunExportDocument, RunOutline, SceneSearchResult, SceneText } from '@timeweft/contract';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';
import { parseOperationInput } from './operations.ts';
import { seedDemoRun } from './seed-demo-run-command.ts';
import { STORY_TOOL_NAMES } from './mcp.ts';

const SLUG = 'the-short-valley';
const AUTHOR_READS = ['read_run', 'read_scene_text', 'search_scenes'] as const;

let running: RunningServer;

before(async () => {
  running = await startServerForTests();
  await seedDemoRun(running.store, { slug: SLUG, scenes: 24 });
});
after(async () => {
  await running.stop();
});

async function answerOf<Answer>(name: string, input: unknown): Promise<Answer> {
  const { status, body } = await running.call(name, input);
  assert.equal(status, 200, `${name} answered ${status}: ${body.refusal ?? ''}`);
  return body.answer as Answer;
}

test('read_run answers the run without any record, and is under half the size of the whole snapshot', async () => {
  // An edit to a record keeps both sides of the prose in its history row; that must not travel either.
  const second = (await running.store.snapshotOf(SLUG, 'author')).scenes.find((scene) => scene.status === 'standing' && scene.number === 2)!;
  await answerOf('edit_scene', { run: SLUG, sceneId: second.id, record: `${second.record}\nThe miller latched the sluice gate behind him.` });
  const outline = await answerOf<RunOutline>('read_run', { run: SLUG });
  const whole = await running.store.snapshotOf(SLUG, 'author');
  assert.equal(outline.scenes.length, whole.scenes.length);
  for (const scene of outline.scenes) {
    assert.ok(!('record' in scene), `scene ${scene.number} carries its record`);
    assert.equal(typeof scene.recordWords, 'number');
  }
  const recordEdits = whole.sceneEdits.filter((edit) => edit.field === 'record');
  assert.ok(recordEdits.length > 0, 'a record was edited');
  for (const edit of outline.sceneEdits.filter((each) => each.field === 'record')) {
    assert.ok(!('earlierValue' in edit) && !('laterValue' in edit), 'a record edit carries the prose');
    assert.equal(typeof edit.earlierWords, 'number');
  }
  const outlineText = JSON.stringify(outline);
  for (const edit of recordEdits) {
    for (const prose of [edit.earlierValue, edit.laterValue]) {
      const longestLine = prose.split('\n').sort((left, right) => right.length - left.length)[0]!;
      assert.ok(!outlineText.includes(longestLine), `the outline carries a record edit's prose: "${longestLine.slice(0, 40)}…"`);
    }
  }
  const wordsInEachRecord = whole.scenes.map((scene) => scene.record.split(/\s+/).filter((word) => word !== '').length);
  assert.deepEqual(outline.scenes.map((scene) => scene.recordWords), wordsInEachRecord);
  const outlineBytes = Buffer.byteLength(JSON.stringify(outline));
  const wholeBytes = Buffer.byteLength(JSON.stringify(whole));
  assert.ok(outlineBytes < wholeBytes / 2, `the outline is ${outlineBytes} bytes against ${wholeBytes} for the whole snapshot`);
});

test("read_scene_text answers one take's prose, struck takes included, and refuses an id the run lacks", async () => {
  const outline = await answerOf<RunOutline>('read_run', { run: SLUG });
  const whole = await running.store.snapshotOf(SLUG, 'author');
  const struck = outline.scenes.find((scene) => scene.status === 'struck');
  assert.ok(struck, 'the demo plan redoes some scenes');
  const text = await answerOf<SceneText>('read_scene_text', { run: SLUG, sceneId: struck.id });
  assert.deepEqual(text, { sceneId: struck.id, number: struck.number, status: 'struck', record: whole.scenes.find((scene) => scene.id === struck.id)!.record });

  const refused = await running.call('read_scene_text', { run: SLUG, sceneId: 'no-such-scene' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.refusal, `The run "${SLUG}" holds no scene with the id "no-such-scene".`);
});

test('search_scenes finds a phrase from the prose over HTTP, and refuses text shorter than two characters', async () => {
  const whole = await running.store.snapshotOf(SLUG, 'author');
  const scene = whole.scenes.find((candidate) => candidate.status === 'standing' && candidate.number === 3)!;
  const phrase = scene.record.split(/\s+/).slice(10, 14).join(' ');
  const result = await answerOf<SceneSearchResult>('search_scenes', { run: SLUG, text: phrase, limit: 200 });
  assert.ok(result.matches.some((match) => match.sceneId === scene.id), `no match for "${phrase}"`);
  for (const match of result.matches) {
    assert.equal(match.excerpt.slice(match.matchStart, match.matchStart + match.matchLength).toLowerCase(), phrase.toLowerCase());
  }
  const numbers = result.matches.map((match) => match.number);
  assert.deepEqual(numbers, [...numbers].sort((left, right) => right - left), 'newest first');

  const tooShort = await running.call('search_scenes', { run: SLUG, text: 'a' });
  assert.equal(tooShort.status, 400);
});

test('the three author reads are refused for a story caller and are not MCP tools', async () => {
  for (const name of AUTHOR_READS) {
    assert.throws(() => parseOperationInput(name, { run: SLUG, sceneId: 'x', text: 'mill' }, 'story'), new RegExp(`${name} is the author's alone`));
    assert.ok(!STORY_TOOL_NAMES.includes(name), `${name} is a tool`);
  }
  const client = await running.mcpClient();
  const { tools } = await client.listTools();
  for (const name of AUTHOR_READS) {
    assert.ok(!tools.some((tool) => tool.name === name), `${name} is offered over MCP`);
    const result = await client.callTool({ name, arguments: { run: SLUG, sceneId: 'x', text: 'mill' } });
    assert.equal(result.isError, true, `${name} answered over MCP`);
  }
});

test('over the story token, the one door it opens (MCP), none of the three is offered or answers', async () => {
  // The story token opens no web route at all, whatever the operation, so a 401 there says nothing
  // about these three. What their audience decides is what the story's MCP connection offers.
  const withStoryToken = await startServerForTests({ storyToken: 'a-story-token-for-the-short-valley' });
  try {
    const storyClient = await withStoryToken.mcpClient('a-story-token-for-the-short-valley');
    const { tools } = await storyClient.listTools();
    assert.ok(tools.some((tool) => tool.name === 'resume_run'), 'the story connection offers its own tools');
    for (const name of AUTHOR_READS) {
      assert.ok(!tools.some((tool) => tool.name === name), `${name} is offered to the story token`);
      const result = await storyClient.callTool({ name, arguments: { run: SLUG, sceneId: 'x', text: 'mill' } });
      assert.equal(result.isError, true, `${name} answered the story token`);
    }
  } finally {
    await withStoryToken.stop();
  }
});

test('resume and export still read the whole run, prose and all', async () => {
  const whole = await running.store.snapshotOf(SLUG, 'author');
  const newest = whole.scenes.filter((scene) => scene.status === 'standing').at(-1)!;
  const exported = await answerOf<RunExportDocument>('export_run', { run: SLUG });
  const exportedScene = (exported.tables.scenes as Array<{ id: string; record: string }>).find((row) => row.id === newest.id)!;
  assert.equal(exportedScene.record, newest.record);
  const briefing = await answerOf<{ text: string }>('resume_run', { run: SLUG, budgetBytes: 200000 });
  assert.ok(briefing.text.includes(newest.title), 'the briefing names the newest scene');
});

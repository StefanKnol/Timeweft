/**
 * Editing a saved scene from the author's pages: `edit_scene` is a web route of the author's alone,
 * never an MCP tool, and what it changes reaches a story only as the newest wording. The demo run the
 * seed command writes carries a handful of edited scenes, so the next pages have some to show.
 *
 * A made-up demo world: a short river valley.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Briefing, EditedScene, RunOutline } from '@timeweft/contract';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';
import { parseOperationInput } from './operations.ts';
import { seedDemoRun } from './seed-demo-run-command.ts';
import { STORY_TOOL_NAMES } from './mcp.ts';
import { planOfDemoRun } from './demo-run.ts';

const SLUG = 'the-edited-valley';
const SCENES = 24;

let running: RunningServer;

before(async () => {
  running = await startServerForTests();
  await seedDemoRun(running.store, { slug: SLUG, scenes: SCENES });
});
after(async () => {
  await running.stop();
});

async function answerOf<Answer>(name: string, input: unknown): Promise<Answer> {
  const { status, body } = await running.call(name, input);
  assert.equal(status, 200, `${name} answered ${status}: ${body.refusal ?? ''}`);
  return body.answer as Answer;
}

test('the seeded demo run carries the planned scene edits, and a story is served none of them', async () => {
  const plan = planOfDemoRun(SCENES);
  const outline = await answerOf<RunOutline>('read_run', { run: SLUG });
  const fieldsPlanned = plan.sceneEdits.reduce((sum, { number: _number, ...fields }) => sum + Object.keys(fields).length, 0);
  assert.equal(outline.sceneEdits.length, fieldsPlanned);
  const newest = outline.scenes.filter((scene) => scene.status === 'standing').at(-1)!;
  assert.ok(outline.sceneEdits.every((edit) => edit.afterSceneId === newest.id), 'every edit is dated after the newest scene');
  assert.deepEqual((await running.store.snapshotOf(SLUG, 'story')).sceneEdits, []);
  const briefing = await answerOf<Briefing>('resume_run', { run: SLUG, budgetBytes: 200000 });
  assert.ok(briefing.text.includes('The author notes the ford is rising again.'), 'a resume reads the newest situation');
});

test('an edit over the web answers the scene as it stands, and a refusal is a 400 with a sentence', async () => {
  const outline = await answerOf<RunOutline>('read_run', { run: SLUG });
  const third = outline.scenes.find((scene) => scene.status === 'standing' && scene.number === 3)!;
  const edited = await answerOf<EditedScene>('edit_scene', { run: SLUG, sceneId: third.id, title: 'The ferry at dusk', placeEntryId: null });
  assert.equal(edited.scene.id, third.id);
  assert.equal(edited.scene.title, 'The ferry at dusk');
  assert.ok(edited.fieldsChanged.includes('title'));
  const again = await running.call('edit_scene', { run: SLUG, sceneId: third.id, title: 'The ferry at dusk' });
  assert.equal(again.status, 400);
  assert.equal(again.body.refusal, 'Nothing given differs from what scene 3 holds, so nothing was changed.');
  const struck = outline.scenes.find((scene) => scene.status === 'struck')!;
  const onStruck = await running.call('edit_scene', { run: SLUG, sceneId: struck.id, starred: true });
  assert.equal(onStruck.status, 400);
  assert.equal(onStruck.body.refusal, `A struck take is kept as it was; edit the standing take of scene ${struck.number}.`);
});

test('edit_scene is refused for a story caller, and is not an MCP tool, over the access token or the story token', async () => {
  assert.throws(() => parseOperationInput('edit_scene', { run: SLUG, sceneId: 'x', title: 'y' }, 'story'), /edit_scene is the author's alone/);
  assert.ok(!STORY_TOOL_NAMES.includes('edit_scene'));
  const client = await running.mcpClient();
  const { tools } = await client.listTools();
  assert.ok(!tools.some((tool) => tool.name === 'edit_scene'));
  const result = await client.callTool({ name: 'edit_scene', arguments: { run: SLUG, sceneId: 'x', title: 'y' } });
  assert.equal(result.isError, true);
  // The story token opens no web route at all, so a 401 there would say nothing about edit_scene.
  // Its one door is MCP, and what edit_scene's audience decides is that it is not offered there.
  const withStoryToken = await startServerForTests({ storyToken: 'a-story-token-for-the-edited-valley' });
  try {
    const storyClient = await withStoryToken.mcpClient('a-story-token-for-the-edited-valley');
    const offered = await storyClient.listTools();
    assert.ok(offered.tools.some((tool) => tool.name === 'save_scene'), 'the story connection offers its own tools');
    assert.ok(!offered.tools.some((tool) => tool.name === 'edit_scene'), 'edit_scene is offered to the story token');
    const overStory = await storyClient.callTool({ name: 'edit_scene', arguments: { run: SLUG, sceneId: 'x', title: 'y' } });
    assert.equal(overStory.isError, true);
  } finally {
    await withStoryToken.stop();
  }
});

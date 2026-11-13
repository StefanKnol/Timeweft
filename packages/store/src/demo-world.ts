/**
 * A made-up world for the store's tests: a miller, a ferry, a ford and a lantern. Inputs go
 * through the contract's own schemas, so every default is filled in exactly as a real caller's
 * would be.
 */
import { OPERATIONS, type InputOf, type RequestOf, type Store } from '@timeweft/contract';

export function sceneInput(request: Partial<RequestOf<'save_scene'>> & { run: string }): InputOf<'save_scene'> {
  return OPERATIONS.save_scene.input.parse({
    title: 'A scene', when: 'the morning', summary: 'Something happened.', situationAfter: 'All is as it was.',
    ...request,
  });
}

export function redoInput(request: Partial<RequestOf<'redo_scene'>> & { run: string; number: number }): InputOf<'redo_scene'> {
  return OPERATIONS.redo_scene.input.parse({
    title: 'A scene again', when: 'the morning', summary: 'Something else happened.', situationAfter: 'All is as it was.',
    ...request,
  });
}

export async function beginDemoRun(store: Store, slug = 'the-ford'): Promise<void> {
  await store.beginRun(OPERATIONS.begin_run.input.parse({
    slug, title: 'The Ford', setting: 'A river valley with one ford.',
    clocks: [{ name: 'days since the flood', countsFrom: 'the morning the river rose' }],
    waypoints: ['The ferry crosses at night.'],
  }));
}

export function stateFactInput(request: RequestOf<'state_fact'>): InputOf<'state_fact'> {
  return OPERATIONS.state_fact.input.parse(request);
}

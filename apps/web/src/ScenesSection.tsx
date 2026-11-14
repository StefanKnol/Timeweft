/**
 * The scenes of a run: the list, or one scene read in full. The address names a scene by its
 * number (the standing take) or, for a struck take, by its id.
 *
 * The list's state is held here rather than in the list, so reading a scene and coming back finds
 * it as it was, and the list knows which row to bring back into view.
 */
import { useEffect } from 'react';
import type { RunOutline } from '@timeweft/contract';
import { SceneList } from './SceneList.tsx';
import { SceneReader } from './SceneReader.tsx';
import { useSectionState, writeLocalText } from './useSectionState.ts';
import { hashOfRoute, hashOfScene, lastReadStorageKey, sceneFromItemId, sceneListStateFromStored, sceneNotFoundInWords } from './shaping.ts';

export function ScenesSection({ snapshot, selectedItemId }: { snapshot: RunOutline; selectedItemId: string | null }) {
  const runSlug = snapshot.run.slug;
  const [listState, setListState] = useSectionState(runSlug, 'scenes', sceneListStateFromStored);
  const found = selectedItemId === null ? null : sceneFromItemId(snapshot.scenes, selectedItemId);
  const openedScene = found !== null && found.found === 'take' ? found.scene : null;
  const listLink = hashOfRoute({ page: 'run', slug: runSlug, section: 'scenes', itemId: null });

  // A scene opened is the one "Continue reading" offers next time, and the row the list brings
  // back into view when the author returns to it.
  useEffect(() => {
    if (openedScene === null) return;
    writeLocalText(lastReadStorageKey(runSlug), String(openedScene.number));
    setListState((state) => (state.returnToNumber === openedScene.number ? state : { ...state, returnToNumber: openedScene.number }));
  }, [runSlug, openedScene, setListState]);

  if (openedScene !== null) {
    return (
      <>
        <p><a href={listLink}>All scenes</a></p>
        <SceneReader scene={openedScene} snapshot={snapshot} />
      </>
    );
  }
  if (found !== null && found.found !== 'take') {
    return (
      <div role="alert">
        <p className="refusal">{sceneNotFoundInWords(found)}</p>
        {found.found === 'every-take-struck' && (
          <ul>
            {found.struck.map((scene) => (
              <li key={scene.id}><a href={hashOfScene(runSlug, scene)}>The struck take: {scene.title}</a></li>
            ))}
          </ul>
        )}
        <p><a href={listLink}>All scenes</a></p>
      </div>
    );
  }
  return <SceneList snapshot={snapshot} state={listState} setState={setListState} />;
}

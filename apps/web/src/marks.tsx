import type { Visibility } from '@timeweft/contract';
import { isAuthorOnly } from './shaping.ts';

/** Drawn beside anything a story is never told, so the author sees at once what a chat cannot. */
export function AuthorOnlyMark({ visibility }: { visibility: Visibility }) {
  if (!isAuthorOnly(visibility)) return null;
  return <span className="author-only-mark">author only</span>;
}

/** Text kept as written: line breaks survive, nothing is reflowed into a different meaning. */
export function KeptText({ text, emptyWords }: { text: string; emptyWords: string }) {
  if (text.trim() === '') return <p className="quiet">{emptyWords}</p>;
  return <p className="kept-text">{text}</p>;
}

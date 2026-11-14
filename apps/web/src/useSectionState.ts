/**
 * What a section shows (its search, filters, how far back it is opened, which boxes are open and
 * where it was scrolled) kept for the browser tab in session storage, so reading one item and
 * coming back, or a reload, puts the section back as it was. One key per run and section.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { RunSection } from './shaping.ts';

function sectionStateKey(runSlug: string, section: RunSection): string {
  return `timeweft.section.${runSlug}.${section}`;
}

function readStoredJson(key: string): unknown {
  try {
    const text = window.sessionStorage.getItem(key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function writeStoredJson(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be turned off or full; the section then forgets on reload, nothing worse.
  }
}

/**
 * A section's state, read from session storage when the section is drawn and written back on every
 * change. `fromStored` turns whatever was stored (or null) into a state, so an older or damaged
 * value falls back to a fresh one.
 */
export function useSectionState<State>(
  runSlug: string,
  section: RunSection,
  fromStored: (value: unknown) => State,
): [State, Dispatch<SetStateAction<State>>] {
  const key = sectionStateKey(runSlug, section);
  const [state, setState] = useState<State>(() => fromStored(readStoredJson(key)));
  const keyDrawn = useRef(key);
  if (keyDrawn.current !== key) {
    // Another run: start from what that run's section kept.
    keyDrawn.current = key;
    const restored = fromStored(readStoredJson(key));
    setState(restored);
  }
  useEffect(() => {
    writeStoredJson(key, state);
  }, [key, state]);
  return [state, setState];
}

/**
 * Keeps where the page was scrolled while `active` (the section's list is drawn), and hands back a
 * way to read it. Written a moment after scrolling stops, never on every frame.
 */
export function useRememberedScroll(runSlug: string, section: RunSection, active: boolean): () => number | null {
  const key = `${sectionStateKey(runSlug, section)}.scroll`;
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scrolled = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => writeStoredJson(key, Math.round(window.scrollY)), 120);
    };
    window.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      window.removeEventListener('scroll', scrolled);
      if (timer !== null) clearTimeout(timer);
    };
  }, [key, active]);
  return useCallback(() => {
    const stored = readStoredJson(key);
    return typeof stored === 'number' && stored >= 0 ? stored : null;
  }, [key]);
}

/** A value kept in the browser's own storage, read and written with care. */
export function readLocalText(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalText(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not kept past this visit.
  }
}

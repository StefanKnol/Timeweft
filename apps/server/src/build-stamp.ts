/**
 * Which build is running, so a live container can be told apart from the one before it.
 *
 * The image is stamped when it is built: the workflow hands the Dockerfile three values and the
 * Dockerfile puts them in the environment. Nothing is typed by hand. A part that is missing or
 * malformed is null rather than guessed, because a stamp that looks right and is not would be
 * worse than none.
 */
export const BUILD_STAMP_VARIABLES = {
  number: 'TIMEWEFT_BUILD_NUMBER',
  commit: 'TIMEWEFT_BUILD_COMMIT',
  builtAt: 'TIMEWEFT_BUILT_AT',
} as const;

export interface BuildStamp {
  /** The count of commits the build was made from. */
  number: number | null;
  /** The short commit hash. */
  commit: string | null;
  /** When the image was built, as an ISO date and time in UTC. */
  builtAt: string | null;
}

export function buildStampFromEnvironment(environment: Record<string, string | undefined>): BuildStamp {
  const numberText = environment[BUILD_STAMP_VARIABLES.number]?.trim() ?? '';
  const commitText = environment[BUILD_STAMP_VARIABLES.commit]?.trim() ?? '';
  const builtAtText = environment[BUILD_STAMP_VARIABLES.builtAt]?.trim() ?? '';
  return {
    number: /^[1-9][0-9]*$/.test(numberText) ? Number(numberText) : null,
    commit: /^[0-9a-f]{7,40}$/.test(commitText) ? commitText : null,
    builtAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(builtAtText) ? builtAtText : null,
  };
}

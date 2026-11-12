/**
 * Five made-up run files about a demo world (a miller, a ferry, a ford, a lantern), written in the
 * shapes a hand-kept run actually drifts into. Used by the tests only.
 */
import type { WeaverFiles } from '@timeweft/contract';

const longOpening = [
  'The rain came down on the mill all night and the miller kept the wheel turning by hand.',
  'At first light she walked to the ford and found the water over the stones, brown and fast.',
  'The ferryman was already on the far bank, waving his hat as if the flood were a festival.',
  'She shouted across that the toll would wait until the water dropped, and he laughed at her.',
  'By noon the rope had held, the barge had crossed twice, and the miller had paid in flour.',
  'The wardens counted the sacks on the landing and wrote the count on a slate by the post.',
  'Nobody mentioned the lantern, though everyone could see it hanging dark from the ferry rail.',
].join(' ');

export const demoLog = `# The Wet Season - Log

# Movement I - The Ford

## Scene 1: Flour at dusk ★
**When:** Mill Day 3 (flood day +5) · the mill yard · dusk · [run begins]
The miller grinds the last of the barley. She hears the river rising.

A second paragraph of the scene that the summary leaves out.
> - Where: the Old Ford, below the mill
> - Who: Ada Brook, Oren Vale
> - Line: Ada: "Not tonight."

## Scene 2
2: The ferry crossing ★
**When:** Day +6 night (Mill Day 4) · the far bank · [one day later]
Oren takes the miller across on the rope ferry.

## Scene 3: The flood
**When:** Mill Day 4 night to Mill Day 5 (flood day +6 to +7) · the ford · [overnight]
${longOpening}
> - Where: the Mill, then the ford
> - What changed: the toll is owed
Ada: "Next week." (a line after the block)

## Scene 4: Flooded
**When:** Flood day · the kitchen
The miller wakes before the cock.

# Movement II - The Lantern

## Scene 5: The lantern relit ★
**When:** Mill Day 9 (flood day +11) · evening · [four days later]
She relights the brass lantern and hangs it in the kitchen window.
`;

export const demoState = `# The Wet Season - State

## Clock
- Current: Mill Day 9 (flood reckoning day +11), evening, the mill kitchen. Before that, Mill Day 8 at the ford, a long wait in the rain.
- Mill clock: running. Mill Day 1 = the day the ferry came (Scene 2), = flood reckoning day +3. Before that, scenes are stamped relative to the flood (eve / flood day / day +N).
- Run began: the eve of the flood

## Current situation
The miller sits up with the lantern (Scene 5). Earlier: she crossed the ford and paid the toll. Earlier: she waited out the rain.

## Run-specific state
- Ada Brook: worn out from the crossing. Earlier: rested (Scene 1).
- the weather: rain all week.
- Tomas: a drover nobody has met on the page.

## Standing rulings (append-only, verbatim)
- "The ferry never runs at night."
- (Scene 2, author direction) "call her the miller in narration"
- (Scene 3, story side) The lantern stays lit through the movement.
- (Before Scene 4, author ruling) "no clock jumps of more than a day"
- (After Scene 4, author ruling) "first person, point of view of the miller"
- (Scenes 2-3, author direction) "Oren Vale names the ford and nobody else does"

## Open threads
- Who sank the old ferry (Scene 2): nobody has said.
- The maker of the Brass Lantern: not yet asked.
- CLOSED: The toll dispute - settled by the ferryman (Scene 4).

## Authored waypoints
- (Author, Scene 3) A night crossing of the ford.
- REACHED: The lantern is relit.

## New canon coined this run
- Invented, check at the end (Scene 2): the ferry runs on a rope.
- AUTHOR RULING, for the close: millers in this valley keep a lantern.
- FLAG for author (Scene 4): the ford has a name nobody uses.

## Kitchen canon (this run)
- Invented (Scene 5): the kitchen hearth never goes out.

## Names used this run
- Ada - A-, 2 syll
- Oren - O-, 2 syll

## Weather notes
A drizzle most days.
`;

export const demoCast = `# The Wet Season - Cast

## Ada Brook (later the Miller) (she)
- **Who:** the miller at the ford.
- **Standing:** trusts the ferryman now (Scene 4). Before: wary of him (Scenes 1-2). Before: a stranger to him.
- **Who (as the ferryman knows her):** a customer who pays late.
- **Voice:** short and dry.
- **State (day +6, night):** on the ferry.
- **Pair (author ruling, Scene 3):** none, by the author's word.
- Scene 1: grinds flour at dusk.
- Scene 2 (day +6): crosses on the ferry.
- Scenes 3-4: keeps the lantern
  burning through the flood.
- **Last seen:** Scene 5, in the mill kitchen

## Oren Vale (he) (the ferryman)
- **Who:** runs the rope ferry.
- Scene 2: takes the miller across.

## The Ford Wardens (they)
- Brin (he): the oldest warden.
- The wardens met the miller at the ford (Scene 3).
- A sentence that nobody filed anywhere.

## The people of the bend
- **Who:** the families downstream.
`;

export const demoItems = `# The Wet Season - Items

## The Brass Lantern
- **What:** a brass lantern with a cracked pane.
- **Where:** with the miller now (Scene 5). Before: on the ferry rail (Scene 2). Earlier: in the ferryman's shed.
- **History:** found in Scene 2.
- **Scene 4:** relit at the ford.
`;

export const demoPlaces = `# The Wet Season - Places

## Journeys and legs
(How long each trip took.)
- The Mill to the Old Ford: half a day on foot.
- The Old Ford to the far bank, by ferry (Scene 2): a slow start; an hour on the rope; calm water.
- The bank is muddy.

| Leg | Costs | By what means | Fixed in |
|---|---|---|---|
| The Mill to the village | two days | cart | Scene 3 |

## The Old Ford (the ford)
- **What:** a stony ford below the mill.
- **State (day +6, night):** flooded.
- **Last seen:** Scene 3, Mill Day 5

## The Mill
- **What:** a water mill.
`;

export const demoFiles: WeaverFiles = {
  log: demoLog,
  state: demoState,
  cast: demoCast,
  items: demoItems,
  places: demoPlaces,
};

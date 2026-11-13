import { strict as assert } from 'node:assert';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';
import { CUT_MARKER, cutToFit, onOneLine } from './text-fitting.ts';

describe('cutToFit', () => {
  it('answers text that already fits unchanged', () => {
    assert.equal(cutToFit('The ferry runs.', 100), 'The ferry runs.');
  });

  it('cuts at the end of a sentence where one falls late enough', () => {
    const text = 'The miller wakes at dawn. She opens the sluice gate. The wheel turns slowly all morning long.';
    const cut = cutToFit(text, 70);
    assert.equal(cut, `The miller wakes at dawn. She opens the sluice gate.${CUT_MARKER}`);
  });

  it('cuts at a space where no sentence ends late enough', () => {
    const text = 'The miller wakes and walks the long way round the pond to the ford before anyone else is up';
    const cut = cutToFit(text, 40) ?? '';
    assert.ok(cut.endsWith(CUT_MARKER));
    const kept = cut.slice(0, -CUT_MARKER.length);
    assert.ok(text.startsWith(kept));
    assert.equal(text.charAt(kept.length), ' ', 'the cut falls on a space');
  });

  it('never splits a character, measuring in UTF-8 bytes', () => {
    const text = 'Flöße über den Fluß. '.repeat(40) + '水車小屋の粉屋'.repeat(40);
    for (let maximumBytes = 30; maximumBytes < 400; maximumBytes += 7) {
      const cut = cutToFit(text, maximumBytes);
      if (cut === null) continue;
      assert.ok(Buffer.byteLength(cut, 'utf8') <= maximumBytes, `${maximumBytes}`);
      assert.ok(!cut.includes('�'), `${maximumBytes}: a character was split`);
    }
    const oneLongWord = '水'.repeat(200);
    const cut = cutToFit(oneLongWord, 50) ?? '';
    assert.ok(Buffer.byteLength(cut) <= 50 && !cut.includes('�'));
  });

  it('answers null where too little would be kept to be worth serving', () => {
    assert.equal(cutToFit('A sentence long enough to need cutting here.', 14), null);
  });
});

describe('onOneLine', () => {
  it('folds line breaks and runs of space into one space', () => {
    assert.equal(onOneLine('  the ford\n\n  at   dusk '), 'the ford at dusk');
  });
});

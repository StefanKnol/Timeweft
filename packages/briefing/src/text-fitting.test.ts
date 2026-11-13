import { strict as assert } from 'node:assert';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';
import { CUT_MARKER, MIDDLE_LEFT_OUT_MARKER, byteLengthOf, cutToFit, onOneLine, openingAndEndingOf } from './text-fitting.ts';

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

describe('openingAndEndingOf', () => {
  it('answers text that fits unchanged', () => {
    assert.equal(openingAndEndingOf('The ferry runs.', 100), 'The ferry runs.');
  });

  it('keeps how a long text opens and how it ends, says the middle is left out, and stays within the size', () => {
    const text = `Who owes the miller for the grain? ${'The baker says the debt is older than the weir. '.repeat(40)}Paid in full at the ford.`;
    const shown = openingAndEndingOf(text, 200);
    assert.ok(byteLengthOf(shown) <= 200, `${byteLengthOf(shown)} bytes`);
    assert.ok(shown.startsWith('Who owes the miller for the grain?'), shown);
    assert.ok(shown.endsWith('Paid in full at the ford.'), shown);
    assert.ok(shown.includes(MIDDLE_LEFT_OUT_MARKER), shown);
    assert.ok(byteLengthOf(shown.split(MIDDLE_LEFT_OUT_MARKER)[1] ?? '') > byteLengthOf(shown.split(MIDDLE_LEFT_OUT_MARKER)[0] ?? ''), 'the ending gets the larger share');
  });

  it('never splits a character of several bytes and never breaks inside a word', () => {
    const text = `${'époque brûlée '.repeat(30)}fin`;
    const shown = openingAndEndingOf(text, 120);
    assert.ok(byteLengthOf(shown) <= 120);
    const [opening, ending] = shown.split(MIDDLE_LEFT_OUT_MARKER);
    for (const word of `${opening} ${ending}`.split(' ')) assert.ok(['époque', 'brûlée', 'fin'].includes(word), `"${word}" is not a whole word`);
  });
});

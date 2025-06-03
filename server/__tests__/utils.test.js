const { createDeck, shuffle } = require('../utils');

describe('utils', () => {
  test('createDeck returns an array of 108 cards and contains 4 JOKERs', () => {
    const deck = createDeck();
    expect(Array.isArray(deck)).toBe(true);
    expect(deck).toHaveLength(108);
    const jokers = deck.filter(card => card.value === 'JOKER');
    expect(jokers).toHaveLength(4);
  });

  test('shuffle returns a new array of the same length without mutating the input', () => {
    const deck = createDeck();
    const original = [...deck];
    const shuffled = shuffle(deck);
    expect(shuffled).not.toBe(deck);
    expect(shuffled).toHaveLength(deck.length);
    expect(deck).toEqual(original);
  });
});

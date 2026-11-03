// The host generates and stores only the selected letters, not a masked full word.
// The supplied shuffle keeps selection testable; the caller provides secure randomness.
export function createHint(word, shuffle) {
  const characters = Array.from(word);
  if (characters.length < 3 || characters.length > 6) throw new Error('お題は3〜6文字にしてください。');
  const count = characters.length <= 4 ? 1 : 2;
  const indices = shuffle(characters.map((_, index) => index)).slice(0, count);
  return Object.fromEntries(indices.map(index => [`p${index}`, characters[index]]));
}

export function hintCharacters(length, hint) {
  return Array.from({ length }, (_, index) => {
    const value = hint?.[`p${index}`];
    return typeof value === 'string' && Array.from(value).length === 1 ? value : '';
  });
}

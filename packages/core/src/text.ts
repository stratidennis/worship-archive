/**
 * Romanian-aware alphabetical ordering for user-visible names and titles.
 *
 * Plain database/index ordering compares Unicode code points, which sends Ă, Â, Î, Ș
 * and Ț to the end. Romanian collation places each letter beside its base letter in
 * the correct alphabet position: A, Ă, Â, B … I, Î, J … S, Ș, T, Ț, U.
 */
const romanianCollator = new Intl.Collator('ro', {
  sensitivity: 'base',
  numeric: true,
});

export function compareRomanianText(left: string, right: string): number {
  return romanianCollator.compare(left, right);
}

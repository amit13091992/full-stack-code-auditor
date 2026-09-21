export function processAll(items: readonly number[]): number[] {
  return items.map((item) => {
    return item * 2;
  });
}

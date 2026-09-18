export function computeAverage(values: number[]): number {
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

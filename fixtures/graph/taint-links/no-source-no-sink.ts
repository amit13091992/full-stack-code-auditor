// No recognized source or sink call signature anywhere in this file - the Taint Graph should
// produce zero FLOWS_TO edges.
export function addNumbers(a: number, b: number): number {
  return a + b;
}

export function logMessage(message: string): void {
  console.log(message);
}

export class Dispatcher {
  literalKey(): number {
    const obj: Record<string, () => number> = { method: () => 1 };
    return obj["method"]();
  }

  variableKey(methodName: string): number {
    const obj: Record<string, () => number> = { method: () => 1 };
    return obj[methodName]();
  }
}

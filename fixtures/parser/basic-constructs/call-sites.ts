export function plainCall(): void {
  foo();
}

export function memberCall(): void {
  obj.method();
}

export function computedLiteralCall(): void {
  obj["method"]();
}

export function computedDynamicCall(): void {
  const key = "method";
  obj[key]();
}

export function newCall(): void {
  new Foo();
}

export function callApplyBindCalls(): void {
  foo.call(this, 1, 2);
  foo.apply(this, [1, 2]);
  foo.bind(this);
}

export function callbackArgument(): void {
  array.map(function (x) {
    return x;
  });
  array.forEach((x) => x);
}

export function noCalls(): void {
  const x = 1;
  return;
}

export function outer(): void {
  function inner(): void {
    innerOnlyCall();
  }
  outerOnlyCall();
  inner();
}

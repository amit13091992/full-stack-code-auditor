export function processOrders(orders: number[]): number {
  let total = 0;

  const validate = (order: number) => {
    if (order < 0) {
      return false;
    }
    return true;
  };

  const applyDiscount = (order: number) => {
    if (order > 100) {
      return order * 0.9;
    }
    return order;
  };

  const applyTax = (order: number) => {
    if (order > 50) {
      return order * 1.1;
    }
    return order;
  };

  const logOrder = (order: number) => {
    if (order > 0) {
      console.log(order);
    }
  };

  const roundOrder = (order: number) => {
    return Math.round(order * 100) / 100;
  };

  const summarize = (order: number) => {
    return `order:${order}`;
  };

  for (const order of orders) {
    if (validate(order)) {
      let value = applyDiscount(order);
      value = applyTax(value);
      value = roundOrder(value);
      logOrder(value);
      summarize(value);
      total += value;
    }
  }

  return total;
}

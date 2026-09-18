export function buildInvoice(
  customerId: string,
  orderId: string,
  amount: number,
  currency: string,
  taxRate: number,
  discount: number
): string {
  return `${customerId}:${orderId}:${amount}:${currency}:${taxRate}:${discount}`;
}

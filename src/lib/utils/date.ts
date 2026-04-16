export function addMonths(input: Date, months: number) {
  const copy = new Date(input);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

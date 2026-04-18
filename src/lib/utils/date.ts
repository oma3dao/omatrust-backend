export function addMonths(input: Date, months: number) {
  const copy = new Date(input);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

export function addYears(input: Date, years: number) {
  const copy = new Date(input);
  copy.setFullYear(copy.getFullYear() + years);
  return copy;
}

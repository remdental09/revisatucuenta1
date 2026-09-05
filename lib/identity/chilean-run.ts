export function normalizeChileanRun(value: string) {
  const compact = value.trim().toUpperCase().replace(/[.\s]/g, "").replace(/-/g, "");
  const match = compact.match(/^(\d{1,8})([0-9K])$/);
  if (!match) return value.trim().toUpperCase();
  const digits = match[1].replace(/^0+(?=\d)/, "");
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped}-${match[2]}`;
}

export type ChileanRunComparison = "matched" | "mismatch" | "unavailable";

export function compareChileanRun(entered: string, extracted: string): ChileanRunComparison {
  const enteredCompact = normalizeChileanRun(entered).replace(/[.\s-]/g, "").toUpperCase();
  const extractedCompact = normalizeChileanRun(extracted).replace(/[.\s-]/g, "").toUpperCase();
  if (!enteredCompact || !extractedCompact) return "unavailable";
  return enteredCompact === extractedCompact ? "matched" : "mismatch";
}

export function isValidChileanRun(value: string) {
  const compact = value.trim().toUpperCase().replace(/[.\s-]/g, "");
  const match = compact.match(/^(\d{1,8})([0-9K])$/);
  if (!match) return false;

  let multiplier = 2;
  let sum = 0;
  for (const digit of [...match[1]].reverse()) {
    sum += Number(digit) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return match[2] === expected;
}

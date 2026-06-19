function normalizeContractText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized ? normalized : undefined;
}

export function outputSatisfiesExpectedText(params: {
  output: string | undefined;
  expectedText: string | undefined;
}): boolean {
  const expectedText = normalizeContractText(params.expectedText);
  if (!expectedText) {
    return true;
  }

  const output = params.output ?? '';
  return (
    output.includes(expectedText) ||
    normalizeContractText(output)?.includes(expectedText) === true
  );
}

export function isProviderErrorArticleTitle(value: string) {
  return /^(?:access denied|attention required|error|feed unavailable|no feed access|service unavailable)(?:\b|\s*[|:-])/i.test(
    value.trim(),
  );
}

export function isProviderErrorArticleTitle(value: string) {
  return /^(?:access denied|attention required|error|feed unavailable|no feed access|service unavailable)(?:\b|\s*[|:-])/i.test(
    value.trim(),
  );
}

const EVENT_SIGNAL_PATTERN =
  /\b(?:accident|agree(?:d|s)?|announce(?:d|s)?|approve(?:d|s)?|arrest(?:ed|s)?|attack(?:ed|s)?|ban(?:ned|s)?|battle|blast|block(?:ed|s)?|ceasefire|collapse(?:d|s)?|conflict|crash(?:ed|es)?|crisis|deal|death|demand(?:ed|s)?|deploy(?:ed|s)?|destroy(?:ed|s)?|die(?:d|s)?|earthquake|elect(?:ed|ion|ions|s)?|evacuat(?:e|ed|es|ion)|explode(?:d|s)?|fire|flood(?:ed|ing|s)?|government|hostage|injur(?:ed|ies|y)|investigat(?:e|ed|es|ion)|kill(?:ed|ing|s)?|launch(?:ed|es)?|law|meet(?:ing|s)?|missile|parliament|peace|protest(?:ed|ers|ing|s)?|quake|resign(?:ed|s)?|sanction(?:ed|s)?|shoot(?:ing|s)?|sign(?:ed|s)?|strike(?:s)?|talks|treaty|trial|vote(?:d|s)?|war|wildfire)s?\b/iu;

/** Reject RSS topic/category labels that are not descriptions of an event. */
export function isNonEventNewsTitle(value: string) {
  const title = value.normalize("NFKC").trim();
  if (!title || isProviderErrorArticleTitle(title)) return true;
  if (
    /\bnews\s*\|\s*today(?:'|’)?s latest stories\s*\|\s*reuters[.!]?$/iu.test(
      title,
    ) ||
    /^(?:latest|breaking)\s+.+\s+news(?:\s+and\s+headlines)?[.!]?$/iu.test(
      title,
    )
  ) {
    return true;
  }

  const words = title.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? [];
  const hasTopicSeparator = /\s(?:&|and|\/|\||·|:)\s/iu.test(title);
  const endsAsSectionLabel =
    /\b(?:current affairs|latest headlines|latest news|news|updates)\.?$/iu.test(
      title,
    );
  const hasEventSignal = EVENT_SIGNAL_PATTERN.test(title);

  return (
    words.length === 1 ||
    (!hasEventSignal && hasTopicSeparator && words.length <= 6) ||
    (!hasEventSignal && endsAsSectionLabel && words.length <= 8)
  );
}

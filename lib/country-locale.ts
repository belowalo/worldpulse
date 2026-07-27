import { canonicalCountryName } from "./country-terms";

const COUNTRY_CODE_OVERRIDES: Record<string, string> = {
  "antigua and barbuda": "AG",
  bolivia: "BO",
  "bosnia and herzegovina": "BA",
  brunei: "BN",
  "cape verde": "CV",
  "czech republic": "CZ",
  "democratic republic of the congo": "CD",
  "east timor": "TL",
  eswatini: "SZ",
  "french southern territories": "TF",
  "heard island and mcdonald islands": "HM",
  iran: "IR",
  "ivory coast": "CI",
  kosovo: "XK",
  laos: "LA",
  "north macedonia": "MK",
  micronesia: "FM",
  moldova: "MD",
  myanmar: "MM",
  "north korea": "KP",
  "northern cyprus": "CY",
  palestine: "PS",
  "republic of the congo": "CG",
  russia: "RU",
  "saint helena ascension and tristan da cunha": "SH",
  "saint lucia": "LC",
  "saint pierre and miquelon": "PM",
  "saint vincent and the grenadines": "VC",
  "sao tome and principe": "ST",
  "siachen glacier": "IN",
  "south korea": "KR",
  "south georgia and the south sandwich islands": "GS",
  syria: "SY",
  taiwan: "TW",
  tanzania: "TZ",
  "timor-leste": "TL",
  "trinidad and tobago": "TT",
  turkey: "TR",
  "turks and caicos islands": "TC",
  venezuela: "VE",
  vietnam: "VN",
};

const LANGUAGE_GROUPS: Array<[string, string[]]> = [
  [
    "fr",
    [
      "BE",
      "BF",
      "BI",
      "BJ",
      "CD",
      "CF",
      "CG",
      "CH",
      "CI",
      "CM",
      "DJ",
      "FR",
      "GA",
      "GN",
      "HT",
      "LU",
      "MC",
      "ML",
      "NE",
      "RE",
      "RW",
      "SC",
      "SN",
      "TD",
      "TG",
      "YT",
    ],
  ],
  [
    "es",
    [
      "AR",
      "BO",
      "CL",
      "CO",
      "CR",
      "CU",
      "DO",
      "EC",
      "ES",
      "GQ",
      "GT",
      "HN",
      "MX",
      "NI",
      "PA",
      "PE",
      "PR",
      "PY",
      "SV",
      "UY",
      "VE",
    ],
  ],
  ["pt", ["AO", "BR", "CV", "GW", "MZ", "PT", "ST", "TL"]],
  [
    "ar",
    [
      "AE",
      "BH",
      "DZ",
      "EG",
      "IQ",
      "JO",
      "KW",
      "LB",
      "LY",
      "MA",
      "MR",
      "OM",
      "PS",
      "QA",
      "SA",
      "SD",
      "SO",
      "SY",
      "TN",
      "YE",
    ],
  ],
  ["de", ["AT", "DE", "LI"]],
  ["nl", ["NL", "SR"]],
  ["it", ["IT", "SM", "VA"]],
  ["pl", ["PL"]],
  ["tr", ["TR"]],
  ["ru", ["BY", "KG", "KZ", "RU"]],
  ["uk", ["UA"]],
  ["ro", ["MD", "RO"]],
  ["hu", ["HU"]],
  ["cs", ["CZ"]],
  ["sk", ["SK"]],
  ["sl", ["SI"]],
  ["hr", ["HR"]],
  ["sr", ["ME", "RS"]],
  ["bg", ["BG"]],
  ["el", ["CY", "GR"]],
  ["da", ["DK"]],
  ["sv", ["SE"]],
  ["no", ["NO"]],
  ["fi", ["FI"]],
  ["et", ["EE"]],
  ["lv", ["LV"]],
  ["lt", ["LT"]],
  ["is", ["IS"]],
  ["he", ["IL"]],
  ["fa", ["AF", "IR"]],
  ["ur", ["PK"]],
  ["hi", ["IN"]],
  ["bn", ["BD"]],
  ["ta", ["LK"]],
  ["th", ["TH"]],
  ["vi", ["VN"]],
  ["id", ["ID"]],
  ["ms", ["BN", "MY"]],
  ["tl", ["PH"]],
  ["zh-CN", ["CN"]],
  ["zh-TW", ["HK", "MO", "TW"]],
  ["ja", ["JP"]],
  ["ko", ["KP", "KR"]],
];

const LANGUAGE_BY_REGION = new Map(
  LANGUAGE_GROUPS.flatMap(([language, regions]) =>
    regions.map((region) => [region, language] as const),
  ),
);

let countryCodeIndex: Map<string, string> | null = null;

function normalizedCountryName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildCountryCodeIndex() {
  const index = new Map<string, string>();
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const region = String.fromCharCode(first, second);
      const displayName = displayNames.of(region);
      if (!displayName || displayName === region) continue;
      index.set(normalizedCountryName(displayName), region);
    }
  }
  for (const [name, region] of Object.entries(COUNTRY_CODE_OVERRIDES)) {
    index.set(normalizedCountryName(name), region);
  }
  return index;
}

export function countryCodeForName(countryName: string) {
  countryCodeIndex ??= buildCountryCodeIndex();
  const canonicalName = canonicalCountryName(countryName);
  return (
    countryCodeIndex.get(normalizedCountryName(canonicalName)) ??
    countryCodeIndex.get(normalizedCountryName(countryName)) ??
    null
  );
}

export function googleNewsLocaleForCountry(
  countryName: string,
  requestedRegion = "",
) {
  const normalizedRegion = requestedRegion.trim().toUpperCase();
  const region = /^[A-Z]{2}$/.test(normalizedRegion)
    ? normalizedRegion
    : countryCodeForName(countryName) ?? "US";
  const language = LANGUAGE_BY_REGION.get(region) ?? "en";
  return {
    region,
    language,
    hl: language,
    ceid: `${region}:${language}`,
  };
}

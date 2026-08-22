const COUNTRY_ALIASES: Record<string, string> = {
  Aland: "Åland Islands",
  "Antigua and Barb.": "Antigua and Barbuda",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Br. Indian Ocean Ter.": "British Indian Ocean Territory",
  "Cayman Is.": "Cayman Islands",
  "Central African Rep.": "Central African Republic",
  Congo: "Republic of the Congo",
  "Czech Rep.": "Czech Republic",
  "Dem. Rep. Congo": "Democratic Republic of the Congo",
  "Dem. Rep. Korea": "North Korea",
  "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea",
  "Faeroe Is.": "Faroe Islands",
  "Falkland Is.": "Falkland Islands",
  "Fr. Polynesia": "French Polynesia",
  "Fr. S. Antarctic Lands": "French Southern Territories",
  "Heard I. and McDonald Is.": "Heard Island and McDonald Islands",
  Korea: "South Korea",
  "Lao PDR": "Laos",
  Macedonia: "North Macedonia",
  "N. Cyprus": "Northern Cyprus",
  "N. Mariana Is.": "Northern Mariana Islands",
  "S. Sudan": "South Sudan",
  "S. Geo. and S. Sandw. Is.":
    "South Georgia and the South Sandwich Islands",
  "Saint Helena": "Saint Helena, Ascension and Tristan da Cunha",
  "Siachen Glacier": "Siachen Glacier",
  "Solomon Is.": "Solomon Islands",
  "St. Pierre and Miquelon": "Saint Pierre and Miquelon",
  "St. Vin. and Gren.": "Saint Vincent and the Grenadines",
  Swaziland: "Eswatini",
  "Turks and Caicos Is.": "Turks and Caicos Islands",
  "U.S. Virgin Is.": "U.S. Virgin Islands",
  "W. Sahara": "Western Sahara",
};

const COUNTRY_RELATED_TERMS: Record<string, string[]> = {
  "Åland Islands": ["Aland Islands", "Åland", "Mariehamn"],
  "American Samoa": ["Pago Pago", "Samoan territory"],
  Afghanistan: ["Afghan"],
  Albania: ["Albanian"],
  Algeria: ["Algerian"],
  Angola: ["Angolan"],
  Argentina: ["Argentine", "Argentinian"],
  Armenia: ["Armenian"],
  Australia: ["Australian"],
  Austria: ["Austrian"],
  Azerbaijan: ["Azerbaijani"],
  Bangladesh: ["Bangladeshi"],
  Belarus: ["Belarusian"],
  Belgium: ["Belgian"],
  Bolivia: ["Bolivian"],
  "Bosnia and Herzegovina": ["Bosnian"],
  Brazil: ["Brazilian"],
  Bulgaria: ["Bulgarian"],
  Cambodia: ["Cambodian"],
  Cameroon: ["Cameroonian"],
  Canada: ["Canadian"],
  Chad: ["Chadian"],
  Chile: ["Chilean"],
  China: ["Chinese"],
  Colombia: ["Colombian"],
  Comoros: ["Comorian", "Moroni"],
  Croatia: ["Croatian"],
  Cuba: ["Cuban"],
  Cyprus: ["Cypriot"],
  "Czech Republic": ["Czech", "Czechia"],
  Denmark: ["Danish"],
  Ecuador: ["Ecuadorian"],
  Egypt: ["Egyptian", "مصر", "مصري", "مصرية", "المصري", "المصرية"],
  Estonia: ["Estonian"],
  Ethiopia: ["Ethiopian"],
  Finland: ["Finnish"],
  France: ["French"],
  "French Polynesia": ["Tahiti", "Tahitian"],
  "French Southern Territories": [
    "Kerguelen",
    "Crozet Islands",
    "French Antarctic",
  ],
  Georgia: ["Georgian", "Tbilisi"],
  Germany: ["German"],
  Ghana: ["Ghanaian"],
  Greece: ["Greek"],
  Haiti: ["Haitian"],
  "Heard Island and McDonald Islands": [
    "Heard Island",
    "McDonald Islands",
    "Australian subantarctic",
  ],
  Hungary: ["Hungarian"],
  Iceland: ["Icelandic"],
  India: ["Indian"],
  Indonesia: ["Indonesian"],
  Iran: ["Iranian"],
  Iraq: ["Iraqi"],
  Ireland: ["Irish"],
  Israel: ["Israeli"],
  Italy: ["Italian"],
  Japan: ["Japanese"],
  Jordan: ["Jordanian", "Amman"],
  Kazakhstan: ["Kazakh"],
  Kenya: ["Kenyan"],
  Kiribati: ["Tarawa", "I-Kiribati"],
  "Cook Islands": ["Rarotonga"],
  "Marshall Islands": ["Majuro", "Marshallese"],
  Micronesia: ["Federated States of Micronesia", "Pohnpei", "FSM"],
  Montserrat: ["Montserratian", "Brades", "Plymouth Montserrat"],
  Nauru: ["Yaren", "Nauruan"],
  Niue: ["Alofi", "Niuean"],
  "Northern Cyprus": ["Turkish Cypriot", "North Cyprus"],
  "Northern Mariana Islands": ["CNMI", "Saipan", "Marianas"],
  Palau: ["Koror", "Palauan"],
  Palestine: [
    "Palestinian",
    "Gaza",
    "West Bank",
    "Ramallah",
    "Palestinian Authority",
    "State of Palestine",
  ],
  Samoa: ["Apia", "Samoan"],
  "Solomon Islands": ["Honiara", "Solomon Islander"],
  Tonga: ["Nuku'alofa", "Tongan"],
  Tuvalu: ["Funafuti", "Tuvaluan"],
  Vanuatu: ["Port Vila", "Ni-Vanuatu"],
  Kuwait: ["Kuwaiti"],
  Latvia: ["Latvian"],
  Lebanon: ["Lebanese", "Beirut"],
  Libya: ["Libyan"],
  Lithuania: ["Lithuanian"],
  Malaysia: ["Malaysian"],
  Mali: ["Malian"],
  Mexico: ["Mexican"],
  Moldova: ["Moldovan"],
  Mongolia: ["Mongolian"],
  Morocco: ["Moroccan"],
  Mozambique: ["Mozambican"],
  Myanmar: ["Burmese", "Burma"],
  Nepal: ["Nepali", "Nepalese"],
  Netherlands: ["Dutch"],
  "New Zealand": ["New Zealander"],
  Nicaragua: ["Nicaraguan"],
  Niger: ["Nigerien"],
  Nigeria: ["Nigerian"],
  "North Korea": ["North Korean", "Pyongyang"],
  Norway: ["Norwegian"],
  Pakistan: ["Pakistani"],
  Panama: ["Panamanian"],
  Paraguay: ["Paraguayan"],
  Peru: ["Peruvian"],
  Philippines: ["Philippine", "Filipino"],
  Poland: ["Polish"],
  Portugal: ["Portuguese"],
  Qatar: ["Qatari"],
  Romania: ["Romanian"],
  Russia: ["Russian"],
  Rwanda: ["Rwandan"],
  "Saint Helena, Ascension and Tristan da Cunha": [
    "Saint Helena",
    "St Helena",
    "Ascension Island",
    "Tristan da Cunha",
  ],
  "Saint Pierre and Miquelon": [
    "Saint Pierre",
    "Miquelon",
    "Saint-Pierre",
    "Saint-Pierre-et-Miquelon",
  ],
  "Antigua and Barbuda": ["Antiguan", "Barbudan", "St John's"],
  Barbados: ["Barbadian", "Bajan", "Bridgetown"],
  Dominica: ["Roseau", "Commonwealth of Dominica"],
  Grenada: ["Grenadian", "St George's"],
  "Saint Kitts and Nevis": ["Kittitian", "Nevisian", "Basseterre"],
  "Saint Lucia": ["Saint Lucian", "Castries"],
  "Saint Vincent and the Grenadines": ["Vincentian", "Kingstown"],
  "U.S. Virgin Islands": ["USVI", "Virgin Islands", "Charlotte Amalie"],
  "Saudi Arabia": ["Saudi"],
  Senegal: ["Senegalese", "Sénégal", "Sénégalais", "Dakar"],
  Serbia: ["Serbian"],
  Singapore: ["Singaporean"],
  Slovakia: ["Slovak"],
  Slovenia: ["Slovenian"],
  Somalia: ["Somali"],
  "South Africa": ["South African"],
  "South Georgia and the South Sandwich Islands": [
    "South Georgia",
    "South Sandwich Islands",
    "South Georgia Island",
  ],
  "South Korea": ["South Korean", "Seoul"],
  "South Sudan": ["South Sudanese"],
  Spain: ["Spanish"],
  Sudan: ["Sudanese"],
  Sweden: ["Swedish"],
  Switzerland: ["Swiss"],
  Syria: ["Syrian"],
  Taiwan: ["Taiwanese"],
  Tanzania: ["Tanzanian"],
  Thailand: ["Thai"],
  Tunisia: ["Tunisian"],
  Turkey: ["Turkish", "Türkiye"],
  Uganda: ["Ugandan"],
  Ukraine: ["Ukrainian"],
  "United Arab Emirates": ["Emirati", "UAE"],
  "United Kingdom": ["Britain", "British", "U.K.", "UK"],
  "United States": ["American", "U.S.", "USA", "US"],
  Uruguay: ["Uruguayan"],
  Venezuela: ["Venezuelan"],
  Vietnam: ["Vietnamese"],
  Yemen: ["Yemeni"],
  Zambia: ["Zambian"],
  Zimbabwe: ["Zimbabwean"],
  "British Indian Ocean Territory": ["Chagos", "Diego Garcia"],
  "São Tomé and Principe": [
    "São Tomé",
    "Sao Tome",
    "São Toméan",
    "Santomean",
  ],
};

// "Georgia" by itself is not reliable country evidence because it also names
// a U.S. state and appears frequently in American local news. These terms keep
// the country discoverable without classifying state-only reporting as GE.
const COUNTRY_MATCH_TERM_OVERRIDES: Record<string, string[]> = {
  Georgia: [
    "Republic of Georgia",
    "Georgia country",
    "Georgian",
    "Tbilisi",
    "Sakartvelo",
    "Batumi",
    "Kutaisi",
    "Rustavi",
    "Adjara",
    "Abkhazia",
    "South Ossetia",
    "Georgian Dream",
    "Georgia's parliament",
    "Georgia's government",
    "Georgia's president",
    "Georgia's prime minister",
    "Georgia and Russia",
    "Georgia and the EU",
    "Georgia and NATO",
  ],
};

export function canonicalCountryName(countryName: string) {
  return COUNTRY_ALIASES[countryName] ?? countryName;
}

export function countrySearchTerms(countryName: string) {
  const canonicalName = canonicalCountryName(countryName);
  const matchTermOverride = COUNTRY_MATCH_TERM_OVERRIDES[canonicalName];
  return [
    ...(matchTermOverride ?? [
      countryName,
      canonicalName,
      ...(COUNTRY_RELATED_TERMS[canonicalName] ?? []),
    ]),
  ]
    .map((term) => term.trim())
    .filter((term, index, terms) => term && terms.indexOf(term) === index);
}

export function countryNameNeedsDisambiguation(countryName: string) {
  return Boolean(COUNTRY_MATCH_TERM_OVERRIDES[canonicalCountryName(countryName)]);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const countryTermPatternCache = new Map<string, RegExp>();

function countryTermPattern(term: string) {
  const cached = countryTermPatternCache.get(term);
  if (cached) return cached;
  const caseSensitiveAcronym = /^[A-Z]{2,3}$/.test(term);
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}([^\\p{L}\\p{N}]|$)`,
    caseSensitiveAcronym ? "u" : "iu",
  );
  countryTermPatternCache.set(term, pattern);
  return pattern;
}

export function textMatchesCountry(text: string, terms: string[]) {
  return terms.some((term) => countryTermPattern(term).test(text));
}

/** Matches a country while rejecting well-known place-name collisions. */
export function textMatchesCountryName(text: string, countryName: string) {
  const canonicalName = canonicalCountryName(countryName);
  if (!textMatchesCountry(text, countrySearchTerms(countryName))) return false;

  if (canonicalName === "Palestine") {
    const hasPalestinianContext =
      /\b(?:Palestinian|Gaza|West Bank|Ramallah|Hamas|Fatah|Palestinian Authority|State of Palestine)\b/iu.test(
        text,
      );
    const hasUnrelatedLocality =
      /\b(?:East|New) Palestine\b|\bPalestine\s*,?\s*(?:Texas|TX|Ohio|OH|Illinois|IL|Indiana|IN)\b/iu.test(
        text,
      );
    if (hasUnrelatedLocality && !hasPalestinianContext) return false;
  }

  if (canonicalName === "Jordan") {
    const hasJordanCountryContext =
      /\b(?:Jordanian|Amman|West Bank|Israel(?:i)?|Palestin(?:e|ian)|Syria(?:n)?|Iraq(?:i)?|Saudi|Middle East|King|Queen|Royal|government|minister|parliament|army|military|border|refugee|diplomat(?:ic)?|embassy|ambassador|trade|market|aid|World Bank|dinar|election)\b/iu.test(
        text,
      ) || /\bJordan(?:'s|’s)?\s+(?:economy|economic)\b/iu.test(text);
    if (!hasJordanCountryContext) return false;
  }

  if (canonicalName === "Lebanon") {
    const hasLebanonCountryContext =
      /\b(?:Lebanese|Beirut|Israel(?:i|'s)?|Syria(?:n)?|Iran(?:ian)?|Middle East|government|president|prime minister|parliament|army|military|economy|economic|World Bank|war|conflict|border|Hezbollah|United Nations|UN|peacekeep(?:er|ers|ing)|displaced|humanitarian|ambassador|amnesty|regional|aid|country|nation|Vatican)\b/iu.test(
        text,
      );
    if (!hasLebanonCountryContext) return false;
  }

  return true;
}

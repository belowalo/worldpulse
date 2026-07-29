import type { Country, CountryPulse } from "./types";

export const countries: Country[] = [
  { iso2: "CA", iso3: "CAN", name: "Canada", mapId: "124", region: "North America" },
  { iso2: "US", iso3: "USA", name: "United States", mapId: "840", region: "North America" },
  { iso2: "MX", iso3: "MEX", name: "Mexico", mapId: "484", region: "North America" },
  { iso2: "BR", iso3: "BRA", name: "Brazil", mapId: "076", region: "South America" },
  { iso2: "AR", iso3: "ARG", name: "Argentina", mapId: "032", region: "South America" },
  { iso2: "GB", iso3: "GBR", name: "United Kingdom", mapId: "826", region: "Europe" },
  { iso2: "FR", iso3: "FRA", name: "France", mapId: "250", region: "Europe" },
  { iso2: "DE", iso3: "DEU", name: "Germany", mapId: "276", region: "Europe" },
  { iso2: "UA", iso3: "UKR", name: "Ukraine", mapId: "804", region: "Europe" },
  { iso2: "NG", iso3: "NGA", name: "Nigeria", mapId: "566", region: "Africa" },
  { iso2: "ZA", iso3: "ZAF", name: "South Africa", mapId: "710", region: "Africa" },
  { iso2: "EG", iso3: "EGY", name: "Egypt", mapId: "818", region: "Africa" },
  { iso2: "IN", iso3: "IND", name: "India", mapId: "356", region: "Asia" },
  { iso2: "CN", iso3: "CHN", name: "China", mapId: "156", region: "Asia" },
  { iso2: "JP", iso3: "JPN", name: "Japan", mapId: "392", region: "Asia" },
  { iso2: "AU", iso3: "AUS", name: "Australia", mapId: "036", region: "Oceania" },
];

export const countryPulses: CountryPulse[] = countries.map((country) => ({
  ...country,
  events: [],
  topEvent: undefined,
}));

export const defaultCountry = "CA";

export function countryByIso(iso2: string) {
  return countryPulses.find((country) => country.iso2 === iso2);
}

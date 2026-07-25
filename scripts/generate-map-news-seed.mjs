import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const baseUrl = process.env.WORLDPULSE_SEED_ORIGIN ?? "http://localhost:4318";
const seedBatchSize = 5;
const maxArticlesPerCountry = 32;
const geojson = JSON.parse(
  await readFile(resolve(projectRoot, "public/countries.geojson"), "utf8"),
);
const countryNames = geojson.features.map(
  (feature) => feature.properties.name,
);

const wait = (milliseconds) =>
  new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

async function fetchCountries(names) {
  const parameters = new URLSearchParams({
    scope: "map",
    countries: names.join("|"),
  });
  const response = await fetch(
    `${baseUrl}/api/live-news?${parameters.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`Map preload returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  return payload.countries;
}

const countryResults = new Map();
for (let index = 0; index < countryNames.length; index += seedBatchSize) {
  const batch = countryNames.slice(index, index + seedBatchSize);
  const results = await fetchCountries(batch);
  for (const result of results) countryResults.set(result.countryName, result);
  await wait(250);
}

for (const countryName of countryNames) {
  const existing = countryResults.get(countryName);
  if (existing?.articles?.length) continue;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await wait(600 + attempt * 500);
    const [retry] = await fetchCountries([countryName]);
    if (retry?.articles?.length) {
      countryResults.set(countryName, retry);
      break;
    }
  }
}

const missingCountries = countryNames.filter(
  (countryName) => !countryResults.get(countryName)?.articles?.length,
);
if (missingCountries.length) {
  throw new Error(
    `Refusing to publish an incomplete map snapshot. Missing real headlines for: ${missingCountries.join(", ")}`,
  );
}

const generatedAt = new Date().toISOString();
const countries = countryNames.map((countryName) => {
  const result = countryResults.get(countryName);
  return {
    countryName,
    generatedAt: result?.generatedAt ?? generatedAt,
    available: Boolean(result?.articles?.length),
    articles: (result?.articles ?? []).slice(0, maxArticlesPerCountry),
  };
});
const output = {
  scope: "map",
  generatedAt,
  refreshAfterSeconds: 600,
  provider: "WorldPulse preloaded local-news snapshot",
  countries,
};

await writeFile(
  resolve(projectRoot, "public/map-news-seed.json"),
  `${JSON.stringify(output)}\n`,
  "utf8",
);

const withHeadlines = countries.filter((country) => country.articles.length);
console.log(
  JSON.stringify({
    countries: countries.length,
    withHeadlines: withHeadlines.length,
    headlines: withHeadlines.reduce(
      (total, country) => total + country.articles.length,
      0,
    ),
  }),
);

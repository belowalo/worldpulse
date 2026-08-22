import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  articlesMentioningCountry,
  buildLiveEvents,
  classifyLiveHeadline,
  enrichEventWithCoverage,
  eventsDescribeSameOccurrence,
  mergeCanonicalEvents,
  mergeEventFeeds,
  newsTextTokens,
} from "@/lib/live-news";
import { canonicalCountryName } from "@/lib/country-terms";
import {
  biasDistributionForArticles,
  canonicalPublisherKey,
  publisherBiasRating,
  showsPublisherPerspective,
} from "@/lib/publisher-bias";
import type { LiveNewsPayload } from "@/lib/types";

const payload: LiveNewsPayload = {
  countryName: "Canada",
  scope: "country",
  generatedAt: "2026-07-25T00:00:00.000Z",
  refreshAfterSeconds: 600,
  provider: "Test RSS",
  articles: [
    {
      id: "one",
      title: "Canada wildfire response expands across western provinces",
      url: "https://example.com/one",
      publisherName: "Reuters",
      publisherUrl: "https://reuters.com",
      publishedAt: "2026-07-24T23:00:00.000Z",
    },
    {
      id: "two",
      title: "Western Canada expands response to major wildfires",
      url: "https://example.org/two",
      publisherName: "Associated Press",
      publisherUrl: "https://apnews.com",
      publishedAt: "2026-07-24T22:30:00.000Z",
    },
  ],
};

describe("live news normalization", () => {
  it("rejects the Rostov drone report for Kazakhstan and keeps its actual countries", () => {
    const droneReport: LiveNewsPayload = {
      ...payload,
      countryName: "Kazakhstan",
      articles: [
        {
          ...payload.articles[0],
          id: "rostov-drone-report",
          title:
            "Ukrainian drones kill two in Russia's Rostov-on-Don, target Taganrog, governor says",
          description:
            "Russian officials reported drone attacks in Rostov-on-Don and Taganrog.",
        },
      ],
    };

    expect(articlesMentioningCountry(droneReport, "Kazakhstan")).toHaveLength(0);
    expect(articlesMentioningCountry(droneReport, "Russia")).toHaveLength(1);
    expect(articlesMentioningCountry(droneReport, "Ukraine")).toHaveLength(1);
  });

  it("recognizes an explicit country reference for every map country", () => {
    const geojson = JSON.parse(
      readFileSync(resolve("public/countries.geojson"), "utf8"),
    ) as {
      features: Array<{ properties?: { name?: string } }>;
    };

    expect(geojson.features).toHaveLength(215);
    for (const feature of geojson.features) {
      const countryName = feature.properties?.name;
      expect(countryName).toBeTruthy();
      const canonicalName = canonicalCountryName(countryName!);
      const explicitCountryReference =
        canonicalName === "Georgia"
          ? "Tbilisi Georgia country"
          : canonicalName;
      const countryPayload: LiveNewsPayload = {
        ...payload,
        countryName: countryName!,
        articles: [
          {
            ...payload.articles[0],
            id: `country-${countryName}`,
            title: `${explicitCountryReference} government announces a national update`,
            description: `The report concerns ${explicitCountryReference}.`,
          },
        ],
      };
      expect(
        articlesMentioningCountry(countryPayload, countryName!),
        countryName,
      ).toHaveLength(1);
    }
  });

  it("classifies representative live headlines", () => {
    expect(classifyLiveHeadline("Parliament approves new election rules")).toBe(
      "Politics",
    );
    expect(classifyLiveHeadline("Wildfire response expands")).toBe(
      "Weather and disasters",
    );
    expect(
      classifyLiveHeadline(
        "「MUSIC AWARDS JAPAN 2026 アニソンスペシャル」放送決定！",
      ),
    ).toBe("Culture and entertainment");
    expect(classifyLiveHeadline("Government announces new tariffs")).toBe(
      "Economy",
    );
    expect(
      classifyLiveHeadline(
        "Trump vows tariffs on Canada over wildfire smoke",
      ),
    ).toBe("Economy");
    expect(
      classifyLiveHeadline(
        "Trump issues 50% tariffs on Canada ahead of Gordie Howe Bridge opening",
      ),
    ).toBe("Economy");
    expect(
      classifyLiveHeadline(
        "Canada marks Gordie Howe bridge opening after trade war deepens",
      ),
    ).toBe("Economy");
    expect(
      classifyLiveHeadline(
        "‘The Daily Show’ tackles Trump’s latest move in his ‘war on Canada’",
      ),
    ).toBe("Culture and entertainment");
    expect(
      classifyLiveHeadline(
        "Canada announces roster for 2026 World Junior Summer Showcase",
      ),
    ).toBe("Sports");
    expect(
      classifyLiveHeadline(
        "Aspen Pharmacare wins Canada approval for generic Ozempic",
      ),
    ).toBe("Health");
    expect(
      classifyLiveHeadline(
        "Beluga whales from closed Canada park arrive in new US homes",
      ),
    ).toBe("Environment");
    expect(
      classifyLiveHeadline(
        "Airbus signs strategic partnership for advanced UAS in Canada",
      ),
    ).toBe("Economy");
    expect(
      classifyLiveHeadline(
        "Pratt & Whitney Canada to invest $275 million in its facility",
      ),
    ).toBe("Economy");
    expect(
      classifyLiveHeadline(
        "China, Philippine coastguard vessels clash in South China Sea",
      ),
    ).toBe("Conflict and security");
    expect(
      classifyLiveHeadline("Rebel uprising grows into a nationwide revolution"),
    ).toBe("Conflict and security");
    expect(
      classifyLiveHeadline(
        "Russia strikes Kyiv and other Ukrainian cities overnight",
      ),
    ).toBe("Conflict and security");
  });

  it.each([
    ["Court convicts former mayor in corruption trial", "Crime and justice"],
    ["Powerful earthquake triggers tsunami evacuation", "Weather and disasters"],
    ["Hospital launches new cancer vaccine trial", "Health"],
    ["Canada rolls out new graphic warnings on cigarette packs", "Health"],
    ["Emergency physicians warn that blood supplies are falling", "Health"],
    ["University students win expanded education rights", "Society and education"],
    ["Airline adds flights after airport rail opening", "Travel and transport"],
    ["National football team reaches World Cup final", "Sports"],
    ["Film festival announces its music award winners", "Culture and entertainment"],
    ["Researchers launch an artificial intelligence satellite", "Science and technology"],
    ["Forest conservation plan cuts carbon emissions", "Environment"],
    ["Oddly shaped garden bench becomes neighborhood curiosity", "Other"],
    ["Wildfires spread across Spain during record heat", "Weather and disasters"],
    ["Jersey Zoo geckos threatened by an invasive ant attack", "Environment"],
    ["Xenophobic violence intensifies near the border", "Conflict and security"],
    ["Police capture an international fugitive", "Crime and justice"],
    ["Authorities uncover a North Korean hacking ring", "Crime and justice"],
    ["Island athletes win at the Commonwealth Games", "Sports"],
    ["Antares red star appears beside the Moon", "Science and technology"],
    ["Temps are predicted to hit 106 in Egypt this week", "Weather and disasters"],
    ["Egypt petroleum exports rise as refinery output surges", "Economy"],
    ["New steel quotas will weaken competition", "Economy"],
    ["Qatar Airways adds a new Auckland route", "Travel and transport"],
    [
      "South Africa warns against searches of migrants' documents",
      "Society and education",
    ],
    [
      "Growing Pains: Rethinking Development Charges in Canadian Municipalities",
      "Economy",
    ],
    [
      "Human rights groups support the museum's curatorial independence",
      "Society and education",
    ],
    [
      "Record Canadian Para presence at 2026 Commonwealth Games",
      "Sports",
    ],
    [
      "Ukraine drone strikes on warehouses hit Russian sellers",
      "Conflict and security",
    ],
    [
      "Israeli settlers set fire to mosques and cars in the West Bank",
      "Conflict and security",
    ],
    [
      "Israeli settlers set fire to mosques, cars and farm land in West Bank, Palestinians say",
      "Conflict and security",
    ],
    [
      "White House will not intervene in extradition to the UK",
      "Crime and justice",
    ],
    ["PM pledges continued support ahead of state visit", "Politics"],
    ["Candidate gets party nod to run against president", "Politics"],
    [
      "Iran warns of retaliation after deadly Caspian Sea strike",
      "Conflict and security",
    ],
    [
      "ICE officer in killing should not have cleared vetting",
      "Crime and justice",
    ],
    [
      "Paddleboarder wins world title in record time after shark rescue",
      "Sports",
    ],
    ["Latest news bulletin for Monday morning", "Other"],
  ] as const)("classifies %s as %s", (headline, expected) => {
    expect(classifyLiveHeadline(headline)).toBe(expected);
  });

  it("normalizes common inflections consistently", () => {
    expect(newsTextTokens("wildfires athletes prices warnings games")).toEqual(
      expect.arrayContaining([
        "wildfire",
        "athlete",
        "price",
        "warning",
        "game",
      ]),
    );
  });

  it("does not let background description text override an explicit headline category", () => {
    const [event] = buildLiveEvents(
      {
        countryName: "Spain",
        scope: "country",
        generatedAt: "2026-07-27T00:00:00.000Z",
        refreshAfterSeconds: 600,
        provider: "Test live index",
        articles: [
          {
            id: "spain-wildfire",
            title: "Firefighters battle unprecedented wildfires in Spain",
            description:
              "The prime minister and government announced an emergency briefing.",
            url: "https://example.com/spain-wildfire",
            publisherName: "Example News",
            publisherUrl: "https://example.com",
            publishedAt: "2026-07-26T23:00:00.000Z",
          },
        ],
      },
      { name: "Spain", iso2: "ES" },
    );

    expect(event.category).toBe("Weather and disasters");
  });

  it("does not ship a static news snapshot", () => {
    expect(existsSync(resolve("public/map-news-summary.json"))).toBe(false);
    const countryMetadata = readFileSync(
      resolve("lib/seed-data.ts"),
      "utf8",
    );
    expect(countryMetadata).not.toMatch(/\b(?:headline|summary|makeEvent)\b/u);
    expect(countryMetadata).not.toContain("example.com");
  });

  it("clusters related reporting and preserves publisher links", () => {
    const events = buildLiveEvents(payload, {
      name: "Canada",
      iso2: "CA",
    });
    expect(events).toHaveLength(1);
    expect(events[0].articles).toHaveLength(2);
    expect(events[0].articles[0].source.publisherName).toBeTruthy();
    expect(events[0].importanceScore).toBeGreaterThan(0);
  });

  it("does not build an event from a cached publisher topic label", () => {
    const events = buildLiveEvents(
      {
        countryName: "Palestine",
        scope: "country",
        generatedAt: "2026-08-21T18:00:00.000Z",
        refreshAfterSeconds: 60,
        provider: "Test RSS",
        articles: [
          {
            id: "democracy-now-topic",
            title: "Israel & Palestine",
            url: "https://news.google.com/rss/articles/democracy-now-topic",
            publisherName: "Democracy Now!",
            publisherUrl: "https://www.democracynow.org/",
            publishedAt: "2026-08-21T17:37:00.000Z",
          },
        ],
      },
      { name: "Palestine", iso2: "PS" },
    );

    expect(events).toEqual([]);
  });

  it("matches global headlines to a country", () => {
    expect(articlesMentioningCountry(payload, "Canada")).toHaveLength(2);
    expect(articlesMentioningCountry(payload, "Japan")).toHaveLength(0);
  });

  it("matches countries mentioned in feed descriptions", () => {
    const descriptionOnly: LiveNewsPayload = {
      ...payload,
      articles: [
        {
          id: "description-only",
          title: "Parliament approves the emergency package",
          description: "Canadian lawmakers backed the measure late Thursday.",
          url: "https://example.com/description-only",
          publisherName: "Example News",
          publisherUrl: "https://example.com",
          publishedAt: "2026-07-24T21:00:00.000Z",
        },
      ],
    };

    expect(articlesMentioningCountry(descriptionOnly, "Canada")).toHaveLength(
      1,
    );
  });

  it("groups differently worded coverage and exposes the top five sources", () => {
    const headlines = [
      "US launches fresh strikes on Iranian military sites",
      "American attacks hit Iran military facilities overnight",
      "Iran military sites hit by fresh US attack",
      "Fresh attacks target Iranian military facilities",
      "US attack targets Iran military sites",
      "Iranian military facilities struck in US attacks",
    ];
    const multiSource: LiveNewsPayload = {
      ...payload,
      countryName: "United States",
      articles: headlines.map((title, index) => ({
        id: `source-${index}`,
        title,
        description:
          "The latest attack involved military facilities in Iran and the United States.",
        url: `https://publisher${index}.example/story`,
        publisherName: `Publisher ${index + 1}`,
        publisherUrl: `https://publisher${index}.example`,
        publishedAt: `2026-07-24T${String(23 - index).padStart(2, "0")}:00:00.000Z`,
      })),
    };

    const events = buildLiveEvents(multiSource, {
      name: "United States",
      iso2: "US",
    });

    expect(events).toHaveLength(1);
    expect(events[0].articles).toHaveLength(5);
    expect(events[0].scoringInput.independentSourceCount).toBe(6);
    expect(events[0].summary).toBe(
      "The latest attack involved military facilities in Iran and the United States.",
    );
  });

  it("matches rewritten country and global headlines to one occurrence", () => {
    const countryEvent = buildLiveEvents(
      {
        ...payload,
        countryName: "United States",
        articles: [
          {
            ...payload.articles[0],
            id: "guardian-heat",
            title:
              "‘Extraordinarily hot’: US heatwave stretches on with millions still under warnings",
            description:
              "Millions across the United States remain under heat warnings.",
            publisherName: "The Guardian",
            publisherUrl: "https://theguardian.com/",
          },
        ],
      },
      {
        name: "United States",
        iso2: "US",
      },
    )[0];
    const globalEvent = buildLiveEvents(
      {
        ...payload,
        countryName: null,
        scope: "global",
        articles: [
          {
            ...payload.articles[0],
            id: "ap-heat",
            title:
              "Heat dome expands across the central United States, creating dangerous conditions for millions",
            description:
              "The US heat wave is putting millions of people at risk.",
            publisherName: "AP News",
            publisherUrl: "https://apnews.com/",
          },
        ],
      },
      null,
    )[0];

    expect(countryEvent.id).not.toBe(globalEvent.id);
    expect(eventsDescribeSameOccurrence(countryEvent, globalEvent)).toBe(true);
    const canonicalEvent = mergeCanonicalEvents(globalEvent, countryEvent);
    expect(canonicalEvent.id).toBe(globalEvent.id);
    expect(canonicalEvent.affectedCountries).toContain("US");
    expect(canonicalEvent.scoringInput.independentSourceCount).toBe(2);
    expect(canonicalEvent.articles).toHaveLength(2);
  });

  it("uses one sorted canonical event set for deep and world-search feeds", () => {
    const deepEvent = buildLiveEvents(
      {
        ...payload,
        articles: [
          {
            ...payload.articles[0],
            id: "deep-politics",
            title: "Australia parliament schedules a national election",
            publishedAt: "2026-07-24T20:00:00.000Z",
          },
        ],
      },
      { name: "Australia", iso2: "AU" },
    )[0];
    const worldEvent = buildLiveEvents(
      {
        ...payload,
        articles: [
          {
            ...payload.articles[0],
            id: "world-travel",
            title: "Australia airport opens a new international travel route",
            publishedAt: "2026-07-24T23:00:00.000Z",
          },
        ],
      },
      { name: "Australia", iso2: "AU" },
    )[0];

    const canonical = mergeEventFeeds([deepEvent], [worldEvent]);
    expect(canonical).toHaveLength(2);
    expect(canonical[0].headline).toBe(worldEvent.headline);
    expect(canonical[0].category).toBe("Travel and transport");
  });

  it("does not merge unrelated crime reports that share generic wording", () => {
    const [seattleEvent] = buildLiveEvents(
      {
        ...payload,
        countryName: "Canada",
        articles: [
          {
            ...payload.articles[0],
            id: "seattle-case",
            title:
              "Suspect dies after Seattle Space Needle shooting leaves victim injured",
            publisherName: "CBC News",
            publisherUrl: "https://cbc.ca/",
          },
        ],
      },
      { name: "Canada", iso2: "CA" },
    );
    const [berlinEvent] = buildLiveEvents(
      {
        ...payload,
        countryName: null,
        scope: "global",
        articles: [
          {
            ...payload.articles[0],
            id: "berlin-case",
            title:
              "Suspect in deadly Berlin Pride attack killed in confrontation with police, officials say",
            publisherName: "BBC News",
            publisherUrl: "https://bbc.com/",
          },
        ],
      },
      null,
    );

    expect(eventsDescribeSameOccurrence(seattleEvent, berlinEvent)).toBe(false);
  });

  it("merges an event-specific search and ranks five distinct publishers", () => {
    const [event] = buildLiveEvents(
      { ...payload, articles: [payload.articles[0]] },
      { name: "Canada", iso2: "CA" },
    );
    const expanded = enrichEventWithCoverage(event, {
      ...payload,
      scope: "event",
      articles: [
        payload.articles[0],
        payload.articles[1],
        ...["BBC News", "CBC News", "Local Desk", "Another Local Desk"].map(
          (publisherName, index) => ({
            id: `expanded-${index}`,
            title: `Canada wildfire response expands across western provinces ${index}`,
            url: `https://expanded${index}.example/story`,
            publisherName,
            publisherUrl: `https://expanded${index}.example`,
            publishedAt: `2026-07-24T${20 - index}:00:00.000Z`,
          }),
        ),
        {
          id: "duplicate-bbc-feed",
          title: "Western Canada wildfire response expands again",
          url: "https://bbc.example/duplicate",
          publisherName: "BBC",
          publisherUrl: "https://bbc.example/different-feed",
          publishedAt: "2026-07-24T19:30:00.000Z",
        },
      ],
    });

    expect(expanded.articles).toHaveLength(5);
    expect(expanded.matchedPublisherCount).toBe(6);
    expect(expanded.importanceScore).toBe(event.importanceScore);
    expect(expanded.importanceLabel).toBe(event.importanceLabel);
    expect(expanded.scoringComponents).toEqual(event.scoringComponents);
    expect(expanded.scoringInput).toEqual(event.scoringInput);
    expect(expanded.summary).toBe(
      "Canada wildfire response expands across western provinces.",
    );
    expect(expanded.summary).not.toMatch(/publishers|expanded topic search/i);
    expect(
      new Set(
        expanded.articles.map((article) => article.source.publisherName),
      ).size,
    ).toBe(5);
    expect(
      expanded.articles.filter((article) =>
        article.source.publisherName.toLowerCase().startsWith("bbc"),
      ),
    ).toHaveLength(1);
    expect(
      expanded.articles.map((article) => article.source.publisherName),
    ).toEqual(
      expect.arrayContaining(["Reuters", "Associated Press", "BBC News"]),
    );
  });

  it("keeps canonical sources when broader coverage returns only new publishers", () => {
    const [event] = buildLiveEvents(
      { ...payload, articles: [payload.articles[0]] },
      { name: "Canada", iso2: "CA" },
    );
    const expanded = enrichEventWithCoverage(event, {
      ...payload,
      scope: "event",
      articles: [payload.articles[1]],
    });

    expect(expanded.matchedPublisherCount).toBe(2);
    expect(expanded.scoringInput).toEqual(event.scoringInput);
    expect(
      expanded.articles.map((article) => article.source.publisherName),
    ).toEqual(expect.arrayContaining(["Reuters", "Associated Press"]));
  });

  it("rejects unrelated articles returned by a broader event search", () => {
    const bridgePayload: LiveNewsPayload = {
      ...payload,
      articles: [
        {
          ...payload.articles[0],
          id: "bridge-original",
          title:
            "Canada reportedly scraps joint bridge celebration with US after Trump renews tariff threat",
          description:
            "The dispute concerns the opening celebration for a Canada-US bridge.",
        },
      ],
    };
    const [event] = buildLiveEvents(bridgePayload, {
      name: "Canada",
      iso2: "CA",
    });
    const expanded = enrichEventWithCoverage(event, {
      ...bridgePayload,
      scope: "event",
      articles: [
        {
          ...bridgePayload.articles[0],
          id: "bridge-match",
          title:
            "Trump tariff threat prompts Canada to cancel joint bridge ceremony",
          publisherName: "BBC News",
          publisherUrl: "https://bbc.com/",
        },
        {
          ...bridgePayload.articles[0],
          id: "wildfire-tariffs",
          title:
            "Trump vows wildfire smoke tariffs on Canada as fires spread",
          description:
            "The president proposed tariffs tied to Canadian wildfire smoke.",
          publisherName: "CBC News",
          publisherUrl: "https://cbc.ca/",
        },
        {
          ...bridgePayload.articles[0],
          id: "iran-strikes",
          title:
            "Trump threatens Iran over frozen assets as US strikes continue",
          description:
            "The latest statement concerned Iran and military strikes.",
          publisherName: "Fox News",
          publisherUrl: "https://foxnews.com/",
        },
      ],
    });

    expect(
      expanded.articles.map((article) => article.source.publisherName),
    ).toEqual(expect.arrayContaining(["BBC News", "Reuters"]));
    expect(expanded.articles).toHaveLength(2);
    expect(expanded.summary).toBe(
      "The dispute concerns the opening celebration for a Canada-US bridge.",
    );
  });

  it("builds a publisher mix that includes unrated outlets", () => {
    const [event] = buildLiveEvents(payload, {
      name: "Canada",
      iso2: "CA",
    });
    const distribution = biasDistributionForArticles(event.articles);

    expect(publisherBiasRating("Reuters")).toMatchObject({
      bucket: "center",
      label: "Center",
    });
    expect(publisherBiasRating("Associated Press")).toMatchObject({
      bucket: "left",
      label: "Lean Left",
    });
    expect(
      publisherBiasRating(
        "ABC News - Breaking News, Latest News and Videos",
      ),
    ).toMatchObject({
      bucket: "left",
      label: "Lean Left",
    });
    expect(publisherBiasRating("Newsweek")).toMatchObject({
      bucket: "center",
      label: "Center",
    });
    expect(publisherBiasRating("New York Post")).toMatchObject({
      bucket: "right",
      label: "Lean Right",
    });
    expect(publisherBiasRating("Fox News")).toMatchObject({
      bucket: "right",
      label: "Right",
    });
    expect(publisherBiasRating("Washington Examiner")).toMatchObject({
      bucket: "right",
      label: "Lean Right",
    });
    expect(publisherBiasRating("National Review")).toMatchObject({
      bucket: "right",
      label: "Right",
    });
    expect(publisherBiasRating("NPR")).toMatchObject({
      bucket: "left",
      label: "Lean Left",
    });
    expect(publisherBiasRating("France 24")).toMatchObject({
      bucket: "center",
      label: "Center",
    });
    expect(publisherBiasRating("Euronews")).toMatchObject({
      bucket: "center",
      label: "Center",
    });
    expect(publisherBiasRating("Sky News UK")).toMatchObject({
      bucket: "center",
      label: "Center",
    });
    expect(canonicalPublisherKey("CBC.ca")).toBe(
      canonicalPublisherKey("CBC"),
    );
    expect(canonicalPublisherKey("BBC.co.uk")).toBe(
      canonicalPublisherKey("BBC News"),
    );
    expect(publisherBiasRating("ABC News Australia")).toBeNull();
    expect(publisherBiasRating("Unknown Local Desk")).toBeNull();
    expect(distribution).toMatchObject({
      left: 1,
      center: 1,
      right: 0,
      unrated: 0,
      rated: 2,
      total: 2,
    });
    expect(
      distribution.percentages.left +
        distribution.percentages.center +
        distribution.percentages.right +
        distribution.percentages.unrated,
    ).toBe(100);
  });

  it("shows publisher perspectives only for political and public-affairs categories", () => {
    expect(showsPublisherPerspective("Politics")).toBe(true);
    expect(showsPublisherPerspective("Economy")).toBe(true);
    expect(showsPublisherPerspective("Conflict and security")).toBe(true);
    expect(showsPublisherPerspective("Crime and justice")).toBe(true);
    expect(showsPublisherPerspective("Sports")).toBe(false);
    expect(showsPublisherPerspective("Culture and entertainment")).toBe(false);
    expect(showsPublisherPerspective("Weather and disasters")).toBe(false);
  });

  it("counts publisher aliases once in the Ground News mix", () => {
    const [event] = buildLiveEvents(payload, {
      name: "Canada",
      iso2: "CA",
    });
    const template = event.articles[0];
    const distribution = biasDistributionForArticles([
      ...event.articles,
      {
        ...template,
        id: "bbc-primary",
        source: {
          ...template.source,
          id: "bbc-primary",
          publisherName: "BBC News",
          url: "https://bbc.com/",
        },
      },
      {
        ...template,
        id: "bbc-alias",
        source: {
          ...template.source,
          id: "bbc-alias",
          publisherName: "BBC",
          url: "https://bbc.co.uk/",
        },
      },
    ]);

    expect(distribution).toMatchObject({
      left: 1,
      center: 2,
      right: 0,
      unrated: 0,
      rated: 3,
      total: 3,
    });
  });

  it("counts unrated publishers in the displayed percentages", () => {
    const [event] = buildLiveEvents(payload, {
      name: "Canada",
      iso2: "CA",
    });
    const template = event.articles[0];
    const distribution = biasDistributionForArticles([
      {
        source: {
          ...template.source,
          id: "rated-reuters",
          publisherName: "Reuters",
          url: "https://reuters.com/",
        },
      },
      {
        source: {
          ...template.source,
          id: "unrated-local",
          publisherName: "Unknown Local Desk",
          url: "https://local.example/",
        },
      },
    ]);

    expect(distribution).toMatchObject({
      left: 0,
      center: 1,
      right: 0,
      unrated: 1,
      rated: 1,
      total: 2,
      percentages: {
        left: 0,
        center: 50,
        right: 0,
        unrated: 50,
      },
    });
  });

  it("prioritizes left, right, and center publishers in the displayed five", () => {
    const [event] = buildLiveEvents(
      {
        ...payload,
        articles: [
          ["Reuters", "https://reuters.com/"],
          ["BBC News", "https://bbc.com/"],
          ["Associated Press", "https://apnews.com/"],
          ["CNN", "https://cnn.com/"],
          ["New York Post", "https://nypost.com/"],
          ["Local Desk", "https://local.example/"],
        ].map(([publisherName, publisherUrl], index) => ({
          id: `balanced-${index}`,
          title: `Canada parliament election campaign expands nationwide ${index}`,
          description:
            "Canada's federal election campaign is expanding nationwide.",
          url: `${publisherUrl}story-${index}`,
          publisherName,
          publisherUrl,
          publishedAt: `2026-07-24T${23 - index}:00:00.000Z`,
        })),
      },
      { name: "Canada", iso2: "CA" },
    );
    const distribution = biasDistributionForArticles(event.articles);

    expect(event.articles).toHaveLength(5);
    expect(distribution.left).toBeGreaterThanOrEqual(1);
    expect(distribution.right).toBeGreaterThanOrEqual(1);
    expect(distribution.center).toBeGreaterThanOrEqual(1);
    expect(
      event.articles.map((article) => article.source.publisherName),
    ).toContain("New York Post");
  });

  it("uses prominence and recency rather than political balance for sports", () => {
    const [event] = buildLiveEvents(
      {
        ...payload,
        articles: [
          ["Reuters", "https://reuters.com/"],
          ["Associated Press", "https://apnews.com/"],
          ["BBC News", "https://bbc.com/"],
          ["The New York Times", "https://nytimes.com/"],
          ["The Washington Post", "https://washingtonpost.com/"],
          ["CNN", "https://cnn.com/"],
          ["National Review", "https://nationalreview.com/"],
        ].map(([publisherName, publisherUrl], index) => ({
          id: `sports-${index}`,
          title: `Canada wins international hockey championship final ${index}`,
          description:
            "Canada won the international hockey championship final.",
          url: `${publisherUrl}story-${index}`,
          publisherName,
          publisherUrl,
          publishedAt: `2026-07-24T${23 - index}:00:00.000Z`,
        })),
      },
      { name: "Canada", iso2: "CA" },
    );

    expect(event.category).toBe("Sports");
    expect(event.articles).toHaveLength(5);
    expect(
      event.articles.map((article) => article.source.publisherName),
    ).not.toContain("National Review");
  });
});

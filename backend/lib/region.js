/**
 * Where the user probably is, and what that should change about an answer.
 *
 * The problem: "which monitor should I buy under $900" gets answered with US
 * retailers and US prices for everyone, because nothing in the prompt says
 * otherwise. A search for "OLED monitor price" returns whatever the search API
 * thinks is generic, and generic means American.
 *
 * WHAT THIS DOES NOT DO: it does not geolocate. There is no IP lookup, no
 * third-party service, and nothing is stored. Everything here is derived from
 * data the browser already volunteers on every request, and the result is a
 * COUNTRY and a CURRENCY — the coarsest thing that changes an answer usefully.
 *
 * Three signals, in descending order of trust:
 *
 *   1. A CDN country header. Cloudflare and Vercel both set one. It is derived
 *      from the connecting IP by infrastructure that already saw it, so it
 *      tells us nothing the network layer did not already know.
 *   2. The IANA timezone the client reports. Stable, user-correctable, and far
 *      more specific than a language tag: `Asia/Dubai` is one country, while
 *      `en-GB` is spoken in dozens.
 *   3. Accept-Language's region subtag. Weakest — it is a preference, not a
 *      location, and `en-US` is the default on devices sold worldwide.
 *
 * Every one of them can be wrong, which is why the result is advisory. It is
 * put in the prompt as a hint the model may override when the user says
 * otherwise, never as a filter on what is searched.
 */

/** Timezone -> ISO country, for the zones a mismatch actually matters in. */
const ZONE_COUNTRY = new Map(
  Object.entries({
    "Asia/Dubai": "AE",
    "Asia/Riyadh": "SA",
    "Asia/Qatar": "QA",
    "Asia/Kuwait": "KW",
    "Asia/Karachi": "PK",
    "Asia/Kolkata": "IN",
    "Asia/Calcutta": "IN",
    "Asia/Dhaka": "BD",
    "Asia/Singapore": "SG",
    "Asia/Tokyo": "JP",
    "Asia/Seoul": "KR",
    "Asia/Shanghai": "CN",
    "Asia/Hong_Kong": "HK",
    "Asia/Manila": "PH",
    "Asia/Jakarta": "ID",
    "Asia/Bangkok": "TH",
    "Asia/Jerusalem": "IL",
    "Asia/Istanbul": "TR",
    "Europe/Istanbul": "TR",
    "Europe/London": "GB",
    "Europe/Dublin": "IE",
    "Europe/Paris": "FR",
    "Europe/Berlin": "DE",
    "Europe/Madrid": "ES",
    "Europe/Rome": "IT",
    "Europe/Amsterdam": "NL",
    "Europe/Brussels": "BE",
    "Europe/Vienna": "AT",
    "Europe/Zurich": "CH",
    "Europe/Stockholm": "SE",
    "Europe/Oslo": "NO",
    "Europe/Copenhagen": "DK",
    "Europe/Helsinki": "FI",
    "Europe/Warsaw": "PL",
    "Europe/Prague": "CZ",
    "Europe/Lisbon": "PT",
    "Europe/Athens": "GR",
    "Europe/Moscow": "RU",
    "Africa/Cairo": "EG",
    "Africa/Lagos": "NG",
    "Africa/Nairobi": "KE",
    "Africa/Johannesburg": "ZA",
    "Africa/Casablanca": "MA",
    "America/Toronto": "CA",
    "America/Vancouver": "CA",
    "America/Edmonton": "CA",
    "America/Winnipeg": "CA",
    "America/Mexico_City": "MX",
    "America/Sao_Paulo": "BR",
    "America/Buenos_Aires": "AR",
    "America/Argentina/Buenos_Aires": "AR",
    "America/Bogota": "CO",
    "America/Santiago": "CL",
    "America/Lima": "PE",
    "Australia/Sydney": "AU",
    "Australia/Melbourne": "AU",
    "Australia/Brisbane": "AU",
    "Australia/Perth": "AU",
    "Pacific/Auckland": "NZ",
  }),
);

/** ISO country -> { currency, name }. Only what a price needs. */
const COUNTRY = new Map(
  Object.entries({
    AE: ["AED", "the UAE"], SA: ["SAR", "Saudi Arabia"], QA: ["QAR", "Qatar"],
    KW: ["KWD", "Kuwait"], EG: ["EGP", "Egypt"], MA: ["MAD", "Morocco"],
    IL: ["ILS", "Israel"], TR: ["TRY", "Türkiye"],
    US: ["USD", "the United States"], CA: ["CAD", "Canada"], MX: ["MXN", "Mexico"],
    BR: ["BRL", "Brazil"], AR: ["ARS", "Argentina"], CO: ["COP", "Colombia"],
    CL: ["CLP", "Chile"], PE: ["PEN", "Peru"],
    GB: ["GBP", "the UK"], IE: ["EUR", "Ireland"], FR: ["EUR", "France"],
    DE: ["EUR", "Germany"], ES: ["EUR", "Spain"], IT: ["EUR", "Italy"],
    NL: ["EUR", "the Netherlands"], BE: ["EUR", "Belgium"], AT: ["EUR", "Austria"],
    PT: ["EUR", "Portugal"], GR: ["EUR", "Greece"], FI: ["EUR", "Finland"],
    CH: ["CHF", "Switzerland"], SE: ["SEK", "Sweden"], NO: ["NOK", "Norway"],
    DK: ["DKK", "Denmark"], PL: ["PLN", "Poland"], CZ: ["CZK", "Czechia"],
    RU: ["RUB", "Russia"],
    IN: ["INR", "India"], PK: ["PKR", "Pakistan"], BD: ["BDT", "Bangladesh"],
    SG: ["SGD", "Singapore"], JP: ["JPY", "Japan"], KR: ["KRW", "South Korea"],
    CN: ["CNY", "China"], HK: ["HKD", "Hong Kong"], PH: ["PHP", "the Philippines"],
    ID: ["IDR", "Indonesia"], TH: ["THB", "Thailand"], MY: ["MYR", "Malaysia"],
    VN: ["VND", "Vietnam"],
    AU: ["AUD", "Australia"], NZ: ["NZD", "New Zealand"],
    NG: ["NGN", "Nigeria"], KE: ["KES", "Kenya"], ZA: ["ZAR", "South Africa"],
  }),
);

const clean = (v) => (typeof v === "string" ? v.trim() : "");

/** The region subtag of the first Accept-Language entry, if it has one. */
const fromAcceptLanguage = (header) => {
  const first = clean(header).split(",")[0].split(";")[0].trim();
  const m = /^[A-Za-z]{2,3}[-_]([A-Za-z]{2})$/.exec(first);
  return m ? m[1].toUpperCase() : null;
};

/**
 * @param {object} input
 * @param {string} [input.cdnCountry]  CF-IPCountry / x-vercel-ip-country
 * @param {string} [input.timezone]    IANA zone the client reported
 * @param {string} [input.acceptLanguage]
 * @returns {{country: string, currency: string, place: string, source: string} | null}
 *   null when nothing usable was supplied — the caller then adds no hint at
 *   all, which is strictly better than guessing "US".
 */
function detectRegion({ cdnCountry, timezone, acceptLanguage } = {}) {
  const candidates = [
    // "XX" is Cloudflare's value for "unknown", and T1 is Tor. Neither is a
    // country, and both would otherwise pass a two-letter check.
    [clean(cdnCountry).toUpperCase(), "cdn"],
    [ZONE_COUNTRY.get(clean(timezone)) || "", "timezone"],
    [fromAcceptLanguage(acceptLanguage) || "", "language"],
  ];

  for (const [code, source] of candidates) {
    if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") continue;
    const entry = COUNTRY.get(code);
    if (!entry) continue;
    return { country: code, currency: entry[0], place: entry[1], source };
  }
  return null;
}

/**
 * The line added to a prompt.
 *
 * Written as a HINT the model may override, not an instruction. A user in Dubai
 * asking about US tax law must still get US tax law, and the surest way to
 * break that is to tell the model where they are as though it were a
 * constraint.
 */
function regionHint(region) {
  if (!region) return "";
  return (
    `The user appears to be in ${region.place} (${region.country}). ` +
    `Prefer retailers, availability and prices relevant there, and quote prices in ${region.currency} ` +
    `where you have them. This is inferred from their device settings and may be wrong — ` +
    `if the question names a different country, or asks about somewhere else, follow the question.`
  );
}

module.exports = { detectRegion, regionHint, ZONE_COUNTRY, COUNTRY };

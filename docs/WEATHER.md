# Flight weather method

AEROLINK requests Open-Meteo's current model estimate for the latitude and
longitude selected in Settings. The service chooses a nearby weather grid cell,
so the result is not an observation at the exact coordinate. Wind and gusts are
modelled at 10, 80 and 120 m above ground; gusts are supplied for 10 m only.
They cannot represent wind at the aircraft's exact position, near obstacles,
or a sudden local gust. Rain probability is for the next available forecast
hour and visibility is a model estimate, not a direct visual-line-of-sight
measurement. The app refreshes every five minutes;
weather older than 30 minutes produces no assessment.
Place search uses Open-Meteo's geocoding service, whose location data is based
on GeoNames. Selecting a place fills its coordinates; a named city is a broad
location, so enter precise coordinates if the launch site is elsewhere.

The advisory is an AEROLINK heuristic, not a DJI instruction or clearance:

- Thunderstorm, fog or precipitation: **Do not fly**.
- Modelled wind at 10, 80 or 120 m, or surface gust, at or above the lower of the DJI rating and pilot limit: **Do not fly**.
- Any of those winds at least 70% of the selected limit: **Caution**.
- Modelled visibility below 1 km: **Do not fly**; below 3 km: **Caution**. These are app thresholds, not legal minima.
- Next-hour rain probability at least 60%: **Caution**. Current rain remains **Do not fly**.
- Missing altitude wind, visibility or rain probability: **Caution**.
- Lito X1 uses DJI's published 10.7 m/s maximum wind resistance.
- Low light or missing daylight information: **Caution**.
- Otherwise: **Favourable · Estimate**. This checks only the conditions above.

The 70% threshold is a conservative app choice. Manufacturer maximum wind
resistance is not an operating target. The app does not assess terrain, nearby
weather cells, battery, airspace, pilot
skill, or aircraft-specific restrictions. Always check on site.

## Aircraft references

| Model | Published maximum wind resistance | DJI source |
| --- | ---: | --- |
| Lito X1 | 10.7 m/s | [Specifications](https://www.dji.com/global/lito-x1/specs) |
| Mini 4 Pro | 10.7 m/s | [Specifications](https://www.dji.com/mini-4-pro/specs) |
| Mini 3 | 10.7 m/s | [Specifications](https://www.dji.com/mini-3/specs) |
| Mini 2 SE | 10.7 m/s | [Specifications](https://www.dji.com/mini-2-se/specs) |
| Mini 4K | 10.7 m/s | [Combined specifications](https://www.dji.com/mini-2-se/specs) |
| Air 3 | 12 m/s | [Specifications](https://www.dji.com/air-3/specs) |
| Air 3S | 12 m/s | [Specifications](https://www.dji.com/air-3s/specs) |
| Mavic 3 Pro | 12 m/s | [Specifications](https://www.dji.com/mavic-3-pro/specs) |
| Mavic 3 Classic | 12 m/s | [Specifications](https://www.dji.com/mavic-3-classic/specs) |
| Neo | 8 m/s | [Specifications](https://www.dji.com/neo/specs) |
| Flip | 10.7 m/s | [Specifications](https://www.dji.com/flip/specs) |
| Avata 2 | 10.7 m/s | [Specifications](https://www.dji.com/avata-2/specs) |

Sources checked 25 October 2026. Check the latest manual for your exact aircraft.

Weather data: [Open-Meteo Forecast API](https://open-meteo.com/en/docs),
[API terms](https://open-meteo.com/en/terms). The public endpoint is available
for noncommercial use under its published terms. A commercial deployment can
set `OPEN_METEO_API_KEY` on the AEROLINK server; the key remains server-side.

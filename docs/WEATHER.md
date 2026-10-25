# Flight weather method

AEROLINK requests Open-Meteo's current model estimate for the latitude and
longitude selected in Settings. The service chooses a nearby weather grid cell,
so the result is not an observation at the exact coordinate. Wind and gusts are
modelled for 10 m above ground. They cannot represent wind at drone altitude,
near obstacles, or a sudden local gust. The app refreshes every five minutes;
weather older than 30 minutes produces no assessment.

The advisory is an AEROLINK heuristic, not a DJI instruction or clearance:

- Thunderstorm, fog or precipitation: **Do not fly**.
- Wind or gust at or above the lower of the DJI rating and pilot limit: **Do not fly**.
- Wind or gust at least 70% of the selected limit: **Caution**.
- Lito X1, whose rating is unverified here: **No assessment** until a pilot
  limit is entered, then **Caution** at best.
- Low light or missing daylight information: **Caution**.
- Otherwise: **Favourable · Estimate**. This checks only the conditions above.

The 70% threshold is a conservative app choice. Manufacturer maximum wind
resistance is not an operating target. The app does not assess terrain, nearby
weather cells, visibility beyond the weather code, battery, airspace, pilot
skill, or aircraft-specific restrictions. Always check on site.

## Aircraft references

| Model | Published maximum wind resistance | DJI source |
| --- | ---: | --- |
| Lito X1 | Unverified | [User manual](https://dl.djicdn.com/downloads/DJI_Lito_X1/UM/20260417/DJI_Lito_X1_User_Manual_en.pdf) |
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

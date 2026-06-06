# Flight Home Radar

A local web app that shows aircraft inside a radius around your home coordinates.

## Live Site

GitHub Pages is published from the `gh-pages` branch:

```text
https://shahet07.github.io/homeflight/
```

## Run

```bash
npm start
```

Open:

```text
http://localhost:4173
```

## Data Sources

- `Demo traffic` works offline and is useful for testing the radar movement.
- `Airplanes.live` uses the public `/v2/point/{lat}/{lon}/{radius}` endpoint.
- `adsb.lol` uses the public `/v2/point/{lat}/{lon}/{radius}` endpoint.
- `ADSB Exchange` requires an API key. You can paste it in the UI or set:

```bash
export ADSB_EXCHANGE_API_KEY="your_key_here"
npm start
```

The app converts your radius from statute miles to nautical miles for ADS-B provider requests, then filters the final result to the selected mile radius.

## Notes

Live ADS-B feeds can be delayed, incomplete, or missing route details. Some private, military, or blocked aircraft may not expose complete metadata.

GitHub Pages is static hosting, so `Demo traffic`, `Airplanes.live`, and `adsb.lol` are available there when the browser allows direct provider requests. `ADSB Exchange` requires the local Node backend or another backend proxy because its API key should not be exposed in a public browser app.

# Event site

Lights Up '28, a fictional customer conference by the fictional company Tarnell. One-page site: plain HTML, CSS and vanilla JS, no build step. All content lives in `data/event.json`.

## Run locally
The page loads its content with `fetch`, so serve the folder instead of opening the file:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy
GitHub Pages: Settings, then Pages, then "Deploy from a branch" with `main` and `/ (root)`.

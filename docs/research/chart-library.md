# Chart library for the dashboard

Research for [#55](https://github.com/l0cky12/Snipe-IT-Desktop-App/issues/55), under the map [#50](https://github.com/l0cky12/Snipe-IT-Desktop-App/issues/50). It feeds [#66 Dashboard: charts and layout](https://github.com/l0cky12/Snipe-IT-Desktop-App/issues/66). Checked on 2026-10-10.

## Answer

**Hand-rolled SVG React components, using `d3-scale` and `d3-shape` as the only helpers.** Together they add about 16 kB gzip. No charting framework.

The audit timeline also gets hand-rolled SVG, but it is a different kind of chart: a strip of dated events on a time axis, not a series plot. None of the candidates has a timeline type. Build it as a row of focusable markers on a `scaleTime` axis, with a plain table of the same audits beside or under it.

Fallbacks, if the hand-rolled route turns out too slow to build:
1. **visx** (about 30 kB gzip). It is the same approach (SVG, React, d3 underneath) with ready-made axes and pie/bar/line shapes. You still write tooltips and keyboard handling yourself.
2. **Recharts** (about 113 kB gzip). It is the batteries-included option and has keyboard support built in. The cost is four times the size and an `role="application"` keyboard model (see below).

Don't use the canvas libraries (Chart.js, uPlot, ECharts in canvas mode) for this dashboard. Canvas can't read the CSS custom properties, and it has nothing a screen reader or the Tab key can reach.

## Why

The four charts are small. A donut of Status Labels (under 10 slices), bars for Category and Location (a few dozen at most), one line of checkouts over time, and a short list of upcoming audits. No candidate's strengths (zoom, brushing, 100k points, 3D, maps) matter at that size. What matters is the constraint list, and each constraint is easiest when we own the SVG:

- **Theme tokens.** SVG elements take `fill: var(--sky)` from CSS, so dark mode switches with no JavaScript, exactly like the current Inventory Chart. Canvas libraries need the tokens read with `getComputedStyle` and the chart redrawn when `prefers-color-scheme` changes ([canvas `fillStyle` takes a parsed colour, not a CSS expression](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-fillstyle)).
- **Keyboard and screen reader.** The current Inventory Chart already has the right pattern (`src/renderer/src/App.tsx`, `BarRow`). Segments are mouse targets with `aria-hidden`, and the key underneath holds one labelled `<button>` per segment, so Tab stops once per segment and Enter opens the filtered List. Hand-rolled SVG keeps that pattern for every chart. Library keyboard models are different (see Recharts below).
- **Click-through to a filtered List** (an open question in #66). This is just an `onClick` on our own `<button>` or `<path>`.
- **Dense look.** No library defaults to fight (Recharts and Nivo ship padding, animation, and legend styles that would all need overriding).
- **Bundle and maintenance.** We own about 200–400 lines of chart code instead of a 100+ kB dependency tree.

The cost is building the hover tooltip, the axis ticks, and the arrow-key behaviour ourselves. `d3-scale` covers the hard part of axes (it picks round tick values and readable date ticks). `d3-shape` covers the donut arc and line path math.

## Comparison

Sizes are what I measured: a bundle importing just a donut, bars and a line (plus tooltip and axes where separate), React left external, built with esbuild 0.28.2 and `--minify`, then gzip -9. Full-package sizes from bundlephobia are in brackets for reference. Activity is from the GitHub API on 2026-10-10.

| Candidate | Renders | Measured min / gzip | Licence | Latest release | Last commit | Fit |
|---|---|---|---|---|---|---|
| Hand-rolled + `d3-scale` + `d3-shape` | SVG (ours) | 47 / **16 kB** | ISC | d3-scale 4.0.2 (2021), d3-shape 3.2.0 (2022) | 2023 (d3-shape) | **Recommended** |
| [visx](https://github.com/airbnb/visx) 4.0.0 | SVG | 89 / 30 kB | MIT | 2026-06-11 | 2026-06-22 | Good fallback |
| [uPlot](https://github.com/leeoniya/uPlot) 1.6.32 | Canvas | 51 / 23 kB | MIT | 2025-03-14 | 2026-09-28 | No: no pie/donut, canvas |
| [Chart.js](https://github.com/chartjs/Chart.js) 4.5.1 + react-chartjs-2 5.3.1 | Canvas | 172 / 60 kB | MIT | 2025-10-13 | 2026-10-03 | No: canvas |
| [Recharts](https://github.com/recharts/recharts) 3.10.1 | SVG | 390 / 113 kB [148 kB] | MIT | 2026-07-25 | 2026-10-09 | Workable, heavy |
| [Nivo](https://github.com/plouc/nivo) 0.99.0 | SVG / canvas | 343 / 116 kB | MIT | 2025-05-23 | 2026-07-21 | No: heavy, still 0.x |
| [ECharts](https://github.com/apache/echarts) 6.1.0 (core, SVG renderer) | Canvas or SVG | 576 / 199 kB [359 kB] | Apache-2.0 | 2026-05-19 | 2026-10-04 | No: heaviest |

Versions, licences and dependency lists are from the npm registry (`registry.npmjs.org/<name>/latest`). Bundlephobia: [recharts](https://bundlephobia.com/package/recharts), [echarts](https://bundlephobia.com/package/echarts).

Bundle size matters less here than on the web. The app loads from disk and works offline, so the cost is parse time and the size of the installer, not download time. That's why the size column is a tie-breaker, not the deciding factor. The deciding factors are theming and accessibility.

### Notes per candidate

**Recharts.** Composable React SVG components, the most-used React option, very active. Version 3 turns its accessibility layer on by default. It sets `role="application"` and `tabIndex={0}` on the chart, and Left/Right arrows move the tooltip between points ([Recharts accessibility docs](https://github.com/recharts/recharts/blob/main/storybook/stories/API/Accessibility.mdx)). Its own wiki says VoiceOver users have to turn QuickNav off to use it ([Recharts and accessibility](https://github.com/recharts/recharts/wiki/Recharts-and-accessibility)). It's one Tab stop with arrow keys inside, which is different from the app's "one button per segment" pattern, and arrows move a tooltip rather than offering a click-through. `Cell` (the per-slice colour) is deprecated and goes away in 4.0 ([source](https://github.com/recharts/recharts/blob/main/src/component/Cell.tsx)). Its dependencies include Redux Toolkit, Immer and react-redux, which is most of the weight.

**visx** (Airbnb). Low-level React SVG primitives over d3: `Pie`, `Bar`, `LinePath`, axes, scales ([visx README](https://github.com/airbnb/visx/blob/master/README.md)). You write the chart; visx gives the parts. It's the closest library to the recommendation. Pick it if hand-written axes become a chore. Peer range is React 18 or 19.

**Chart.js.** Tree-shakeable if you register only the controllers you use ([Chart.js integration docs](https://www.chartjs.org/docs/latest/getting-started/integration)). It draws to `<canvas>`, and its own docs say canvas content "is not accessible to screen readers". You add `role="img"`, an `aria-label`, or fallback content yourself ([Chart.js accessibility](https://www.chartjs.org/docs/latest/general/accessibility.html)). Nothing inside is focusable, and colours must be concrete values.

**ECharts.** The most capable option. It has a generated `aria-label` description and decal patterns for colour-blind readers ([ECharts handbook: aria](https://github.com/apache/echarts-handbook/blob/master/contents/en/best-practices/aria.md)). It has an SVG renderer ([canvas vs SVG](https://github.com/apache/echarts-handbook/blob/master/contents/en/best-practices/canvas-vs-svg.md)), and from v6, `setTheme()` for dark mode ([v6 features](https://github.com/apache/echarts-handbook/blob/master/contents/en/basics/release-note/v6-feature.md)). It's also the only one with a ready way to draw a timeline (custom series). But even tree-shaken it's about 200 kB gzip. Its themes are JS objects, so our CSS tokens would be copied into JS. And the aria support is a description, not keyboard navigation.

**Nivo.** Nice-looking React charts with good `ariaLabel`, `isFocusable` and per-bar aria props ([BarSvgExtraProps](https://github.com/plouc/nivo/blob/master/packages/bar/src/types.ts)). But each chart type is its own package pulling lodash, react-spring and many d3 modules. About 116 kB for three charts, and it's still pre-1.0.

**uPlot.** Tiny and very fast for time series ([uPlot](https://github.com/leeoniya/uPlot)). But it's canvas-only and has no pie or donut. Bars and timelines are demo plugins, not built in ([demos](https://github.com/leeoniya/uPlot/tree/master/demos)). It's built for 100k-point plots, which we don't have.

**d3-scale / d3-shape.** These are pure functions with no DOM and no React: `scaleLinear`, `scaleBand`, `scaleTime` with readable ticks, and `pie`, `arc`, `line`. Their last releases are from 2021/2022, and the repos haven't changed since 2023. That reads as finished rather than abandoned: both are part of D3, and visx and Nivo depend on them. If either ever needs replacing, the part we use is small enough to copy in.

## The audit timeline

It needs a different approach. Bars, the donut and the line are all *values per category or per time bucket*. The timeline is *discrete events on dates*: "Audit due" per Asset or Location, with the next major audit marked. No candidate has a timeline type:

- Recharts and Chart.js would fake it with a scatter or floating bars.
- uPlot has a timeline plugin demo.
- ECharts would need a custom series.

Build it as:
- A horizontal SVG strip with an `x = scaleTime(today … +N weeks)` axis and a "today" rule.
- One marker per audit (or per day, with a count, when they bunch up). Each marker is a real `<button>` with an `aria-label` like "Main office audit due 14 Nov". Enter opens the filtered List.
- Audit late shown with the reserved status colour **plus** an icon and the word "late", never colour alone.
- A table of the same rows next to it. The app favours "tables over cards", and the table is the screen-reader and print view.

#66 still has to decide whether the strip earns its place over just the table.

## Accessibility checklist (from the dataviz skill)

This applies whichever library is chosen:

- **Identity is never colour alone.** Every multi-series chart keeps a legend of labelled buttons with counts, like the current `.bar-key`. Up to four series are also labelled directly.
- **A table view exists for every chart.**
- **Hover details also show on keyboard focus.** Hit targets are bigger than the marks.
- **Dark-mode colours are chosen and checked separately against the dark surface,** not just inverted.
- **Donut: at most 6 slices,** and only for part-to-whole at a glance. If Status Labels exceed that, fold the rest into "Other". If #66 wants comparison, use a stacked bar.
- **One y-axis per chart.** Never two.

**Palette finding for the design-system ticket.** I ran the skill's palette validator (`validate_palette.js`) on the current accent tokens, used as a categorical set in this order: violet, sky, leaf, tangerine, coral, slate.
- **Light** (surface `#fcfcfb`): it **fails**. Sky and violet are only ΔE 5.8 apart for deuteranopes. Coral and tangerine are only ΔE 8.2 apart even with normal vision (the floor is 15). Slate reads as grey (chroma 0.044). Leaf and tangerine are under 3:1 contrast against the surface.
- **Dark** (surface `#122047`): it also fails. Sky and violet drop to ΔE 3.7 for deuteranopes, and every token is outside the lightness band.

Either the categorical order needs re-stepping (and coral/tangerine kept apart), or charts must always carry direct labels. This belongs with the design-system work, not the library choice.

One more limit: Status Label colours come from Snipe-IT as arbitrary hex values, so the donut can't guarantee colour-blind-safe colours. The labelled legend and the table are the safeguard there.

## Sources

- npm registry metadata: `https://registry.npmjs.org/{recharts,@visx/shape,chart.js,react-chartjs-2,echarts,@nivo/core,@nivo/bar,uplot,d3-shape,d3-scale}`
- GitHub REST API `repos/{owner}/{repo}` and `/commits?per_page=1` for each repo linked above
- Bundlephobia size API, `https://bundlephobia.com/api/size?package=<name>`
- Tree-shaken sizes: own measurement with esbuild 0.28.2 (entry imports listed in the Comparison section), in a scratch directory outside the repo
- Recharts accessibility: https://github.com/recharts/recharts/blob/main/storybook/stories/API/Accessibility.mdx, https://github.com/recharts/recharts/wiki/Recharts-and-accessibility
- Chart.js accessibility and tree-shaking: https://www.chartjs.org/docs/latest/general/accessibility.html, https://www.chartjs.org/docs/latest/getting-started/integration
- ECharts aria/decal, renderers, v6 themes: https://github.com/apache/echarts-handbook (best-practices/aria.md, best-practices/canvas-vs-svg.md, basics/release-note/v6-feature.md)
- Nivo bar types: https://github.com/plouc/nivo/blob/master/packages/bar/src/types.ts
- visx: https://github.com/airbnb/visx/blob/master/README.md
- Canvas `fillStyle`: https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-fillstyle

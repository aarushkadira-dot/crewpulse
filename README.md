# Quorum

**NASA Space Apps Challenge 2026 · Create Health Monitoring Software for Astronauts on Space Missions · Team GOATS (Raleigh, NC)**

**Live site: https://quorom-nasa.vercel.app**

On Mars, a sick astronaut and a bad reading look the same. Quorum tells the crew which one they are looking at, then what to do.

Quorum is a health tool for astronauts who have to assess themselves. It compares each astronaut with their own preflight baseline, and before any result reaches a health decision it runs a **source check**: is the change in one person, in what the crew shares, or in the measurement? It then turns the daily check-in into an on-board Go / Go with limits / No-go call that the crew can trust when Earth is up to 22 minutes away, or out of contact during solar conjunction.

Why the source check matters: analyzers are verified with control samples, and the ones flown so far last months, while a Mars mission lasts years. For most of the trip the crew's own results are the only reference left.

## What's here

| Page | What it is |
|---|---|
| `index.html` | Front page: who it is for, what is new, and the result on NASA data |
| `app.html` | The app. **Today** is the crew member's to-do list and anything needing attention; **Labs** replays the real Inspiration4 draws with a trust status on every result. Other screens open on a demo mission (a 14-sol sample crew history). Scenario switches for judges are under "Demo controls" in the corner |
| `proof.html` | The evidence: the source check run on real NASA Inspiration4 bloodwork |
| `js/analysis.js` | The method, as one dependency-free module (works in the browser and in Node) |
| `test/test.js` | Checks every number shown on the Proof page and the Labs screen: `node test/test.js` |
| `js/formats.js` | Input formats: lab result messages (HL7 v2) and Apple Health exports |
| `test/validate.js` | Simulation: inject a known cause into synthetic crews and count how often the source check names it |
| `data/` | NASA OSDR originals, unmodified: LSDS-7 (CBC) and LSDS-8 (CMP); `validation.json` (simulation output); a synthetic sample lab message |

## The result in one line

At the first draw after landing (R+1), mean corpuscular volume (MCV, red-cell size) fell below the personal prediction band for all four Inspiration4 crew, while every value stayed inside the lab's reference range. A baseline-only monitor raises four alarms. The source check returns **instrument suspected**: red-cell size was already rising together across the three preflight draws, no related red-cell marker moved, and the same shift is still present 194 days after a three-day flight.

A second case at R+45: potassium up (+17.9%) with glucose down (-31.7%) across the crew, the signature of a sample that waited before processing. The check labels the pair **sample handling suspected** and leaves the rest of the draw usable.

We do not claim either is proven. The public files carry no instrument, lot or handling records. The fingerprints rank the explanations; on board, a retake or a control sample would settle it.

## Method

For each marker, the flag test is

```
d = (x − mean_preflight) / (s · √(1 + 1/n))     flag if |d| > t(df)
z_crew = mean(d) · √n_crew                       alarm if |z| > t(df) and at least half the crew is flagged
```

- `s` is the within-person preflight SD, pooled across the crew; `n` is the number of preflight draws (3).
- `t(df)` is the two-sided 95% Student t limit for the degrees of freedom behind `s` (2.306 for 8), not the large-sample 1.96.
- The crew shift is the "average of deltas" idea from patient-based quality control, with the crew as the patients.
- Each crew-wide alarm is scored on five fingerprints: a known handling pair, recurrence at later draws, co-movement in the baseline, whether related markers moved, and timing against the exposure.
- Every result gets a status: trusted, retake, on hold, shared cause, or review the person. At R+1: 136 trusted, 3 retake, 4 on hold, of 143.
- False flags, leave-one-out on preflight draws: 1.5% for personal flags (6 of 396), 0 of 102 for the crew-wide alarm, against 3.8% for lab ranges. These are in-sample and optimistic.
- Detection limits: from the preflight variation, a crew of four can catch a crew-wide shift of 5% or less in one round for 9 of 36 markers (sodium 1.2%, MCV 1.5%). The rest need a real control sample. The 5% cut-off is a demonstration setting.
- Data check: one row (C003, L-92, CBC) fails internal arithmetic checks. Its 9 affected values are excluded, and the evidence is logged on the Proof page.

This is a transparent Gaussian prediction band, not a validated clinical reference change value (RCV). A clinical RCV must separately account for assay imprecision and validated analyte-specific within-person biological variation. With four people the method is only useful for tightly regulated markers.

The Proof page includes the assumption register, robustness analysis, NASA requirement traceability and a four-stage validation roadmap.

## Adding a blood draw

On the Labs screen, "Add a blood draw" lets the crew medical officer enter a new draw or a retake: days after landing, then one line per marker with a value for each crew member (typed in, or filled from a CSV with lines like `MCV,93.4,95.1,91.8,90.2`). The draw is saved on the device, compared with each person's preflight normal, and put through the same source check as the NASA draws. A retake that comes back inside the crew's normal closes the open alarm; one that is still shifted keeps the results on hold. The NASA draws themselves are never changed.

## Mission scenarios it handles

- **Something the crew shares changes.** A mission event log on the Labs screen (water, food, cabin air, schedule, a new cartridge lot, analyzer service). When a new crew-wide shift appears, the source check lines it up against events since the previous draw. An event never explains a shift that was already there.
- **The medical officer is out.** A six-step stand-in guide in plain words that any crew member can follow, built from what the app already knows.
- **Someone under-reports.** "Said vs measured" compares self-reports with sensor readings and treats a skipped check-in as a signal.
- **No link to Earth.** The site installs as an offline app (service worker), reports wait in a queue, and a compact packet is sent first when the link is weak.
- **Medicines run out or expire.** Stock, expiry against the days of mission left, and a dose log.
- **Solar storm.** A shelter timer with roll call and a dose table per person. Dose rates are simulated.
- **A crew member with no preflight baseline.** Their results are judged against the typical range, labelled as such, until three of their own draws exist.

Stress tests cover bad input, damaged saved data, injected markup, random clicking and running with no network.

## Toward real use

- **Simulation check.** No second crew with public bloodwork of this kind was found, so the check is stress-tested on synthetic crews built from the real preflight statistics (2,000 per case). For a crew of four: a 5% instrument error on red-cell size is caught 98% of the time, a shared cause was not mistaken for the instrument, and a real change in one person was blamed on the crew 6.5% of the time. The weak spot is reported too: with nothing wrong, about one draw in three raises a false crew-wide alarm on one of 36 markers, which is why the first action is always a retake. Full table on the Proof page.
- **Real input formats.** The Labs form reads the HL7 v2 result message a lab analyzer or its data manager sends (tests matched by LOINC code, units converted, inexact results such as "<20" skipped). The Data screen reads an Apple Health `export.xml` of any size, day by day.
- **Accessibility.** Every screen passes the automated WCAG 2.2 AA audit (axe-core) at desktop and phone width, with a skip link, visible focus, keyboard reachability and reduced-motion support.

Not built yet: shared crew accounts. Everything is stored on one device. A flight version would need one crew record synced across devices, sign-in with roles (only the medical officer edits blood draws), privacy enforced by the server, and an audit trail.

## Research basis

- **Earth-independent care:** NASA's Exploration Medical Capability research identifies autonomous clinical decision support as a need when communication, evacuation and resupply cannot be assumed.
- **Personalized laboratory interpretation:** Coşkun et al. show how repeated steady-state results and within-subject biological variation can produce personalized laboratory intervals. Quorum uses that direction of research, but does not claim clinical equivalence.
- **Sleep plus performance:** Jones et al. found that short sleep during ISS missions was associated with slower psychomotor response and greater stress and workload. That supports showing sleep beside a short vigilance task instead of treating either as a complete fitness test.
- **Red-cell relevance:** Trudel et al. establish that red-cell destruction changes during long-duration spaceflight. That makes red-cell monitoring mission-relevant, but does not explain the MCV pattern found here.
- **Quality control without control samples:** patient-based real-time quality control (Badrick et al. 2019) and the average-of-deltas method (Jones 2016) use patients' own results to detect analyzer shifts. Quorum adapts that to a crew of four. We found no published use in spaceflight; that is an absence in our search, not proof.
- **Control shelf life:** NASA's in-situ lab analysis work reports control solutions lasting about 3.5 months in cold stowage (NTRS 20230006919) and lists reagent shelf life as an open problem.
- **Requirements:** NASA-STD-3001 Volume 1 requirements 3003, 3004(h), 3004(p), 3004(t), 7001 and 7003 are mapped to implemented evidence or an explicit prototype gap on the Proof page.

Primary references and direct links are listed on `proof.html`.

## Data

- NASA OSDR LSDS-7, Inspiration4 Complete Blood Count, doi:10.26030/e0rx-sh52
- NASA OSDR LSDS-8, Inspiration4 Comprehensive Metabolic Panel, doi:10.26030/mc5d-p710
- NASA DONKI space weather notifications, read live in the app (api.nasa.gov, then NASA CCMC); if neither can be reached, the app shows the last notices it saved, with their date
- Thresholds and requirement IDs from NASA-STD-3001 Vol. 1 and 2

The Ruth Okafor crew history in the app is simulated, and is labeled "Demo mission · sample crew" everywhere it appears. On the Labs screen the blood results are real; the control-kit count, expiry and mission days are a simulated overlay and are labeled as such.

## Run it

It's static files with no build step.

```
python3 -m http.server 8000      # then open http://localhost:8000
node test/test.js                # verify every Proof-page number, the input formats and the simulation file
node test/validate.js            # rerun the simulation (about 5 minutes)
```

Opening the files directly (file://) blocks the data fetch, so use any local server or GitHub Pages.

The live space-weather feed uses a free NASA key from api.nasa.gov, set as `DONKI_KEY` in `app.html`. If the feed cannot be reached, the card falls back to the last saved copy.

## Use of AI

We used Claude (Anthropic) throughout, as a coding and research assistant. Under the team's direction it wrote most of the HTML, CSS, JavaScript and tests, drafted page text, ran the analysis and stress tests, and searched NASA documents for requirement numbers. The team chose the challenge, the idea and the method, decided what to build and what to claim, and reviewed the results. Every number on the Proof page is computed in `js/analysis.js` from the unmodified NASA files and is checked by `test/test.js`. No AI-generated images, audio or video are used, and nothing here uses NASA logos or branding.

## License

MIT (see `LICENSE`). NASA OSDR data files are NASA's and are included unmodified.

## Credits

- Anatomy figure adapted from react-muscle-highlighter (MIT)
- Icons from Tabler Icons (MIT)
- Typeface: IBM Plex Sans (SIL Open Font License), shipped in `fonts/` so no outside font service is called

Quorum is not a medical device. No NASA logos or endorsement are implied.

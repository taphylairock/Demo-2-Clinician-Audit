# Clinician audit

Checks a virtual-care provider's day, minute by minute, for possible time fraud: **scheduled and paid, patients waiting, and the provider not seeing patients.**

- Nothing to install. It runs in your web browser (Chrome or Edge).
- No AI and no tokens. Every flag is plain arithmetic on times, so any result can be checked by hand.
- Your files are read inside the browser tab and **never uploaded anywhere**. The page is also blocked from making network requests.
- Times are shown in Eastern time (EST/EDT).

## Start in two minutes (no real data needed)

1. Download this repo as a ZIP (green **Code** button, then **Download ZIP**) and **Extract All**.
2. Double-click `index.html`. It opens in your browser.
3. Choose **Try it with made-up sample data**.

You will see a timeline for a made-up provider, Nora Demo. Try searching `casey` (a care manager) or `quinn` (an on-call shift, which is not flagged). The names are made up.

## Use it with real data

### 1. Get three CSV files

| File | What it is | Required |
|---|---|---|
| Encounters and consults | One row per provider per encounter, for **all** providers | Yes |
| Scheduled shifts | One row per shift, for **all** providers | Yes |
| Other activity | Slack or CHR events, to show what the provider did during a gap | No |
| Provider names | Two columns: provider ID and name. Only used to search by name | No |

In Metabase, open the master report, set the dates, and choose **Download results > .csv**.
The exact columns are listed in [`docs/data-requirements.md`](docs/data-requirements.md). Send that page to your data team.

Why "all providers"? Patients waiting and the comparison with peers are worked out from everyone's encounters, not only the provider being checked.

Save the files in the `my-data` folder (it is excluded from Git).

### 2. Run the audit

1. Open `index.html`.
2. Under **Load your data**, choose each file.
3. Search for the provider and set the dates. Type part of a name (in any order, for example `smith jane` or `Smith, Jane`) or an ID, pick them from the list, and choose **Run audit**. If several providers match, the list shows each one with their ID and role so you can choose the right one.

Each time you reopen the page you load the files again. Nothing is kept between visits, which is deliberate.

### About names
Names are only used to find the provider on screen. They are **not** needed in the encounters or shifts files, and the tool still works on IDs underneath, so searching by ID always works too.

- Keep the names file in `my-data` and never upload it to GitHub (CSV files are excluded by `.gitignore`).
- The flags CSV you download contains IDs only. If you want a name column in it, set `includeNamesInCsv: true` in `js/config.js`, but then treat that file as sensitive.
- Names tied to minute-by-minute activity make the result identifiable. Confirm with privacy or HR that this is acceptable before the first audit conversation.
- The names usually come from the provider table in Metabase (`dim_practitioners`). Ask the data team for `practitioner_id` and name.

## Reading the results

**Timeline.** One day at a time (use the day box). From top to bottom: the scheduled shift, the consults, the flags, Slack/CHR markers, and a ribbon of how many patients were waiting. Red bands run down through every row, so you can see how many patients were waiting while the provider had no consults. Hover over anything for details.

**Flags.** A table of every flag, with a **Download flags as CSV** button.

| Flag | What it means |
|---|---|
| Gap between consults | More than 20 minutes (NP, MD) or 15 minutes (CM) between two consults inside a shift, with the number of patients waiting in intake and triaged |
| Empty block | An hour or more at the start or end of a shift, or a whole shift, with no consults, with the number of patients waiting |
| No video call | The patient chose video but no video call is recorded (NP and MD only) |

On-call and training shifts are shown but not flagged. Admin shifts are flagged and labelled. All of these limits can be changed (see below).

**Provider vs peers.** For each shift: other providers in the same role working at the same time, and how this provider compares on consults per hour and share of time in consults, next to the average number of patients waiting.

**Data quality.** Anything that makes a result less certain. Read it before acting on a flag.

### Care managers: please read
There is not yet a message-by-message record of what care managers do. The tool estimates their time from `participant_joined_at` plus engaged seconds. A quick message at 5:15pm and a chart closed at 8:30pm is counted as a few minutes of work, not three hours. Care manager flags are marked **Low confidence** and should be treated as leads to check, not conclusions.

### A flag is a reason to look closer, not proof
Check shift notes, system outages and approved exceptions first.

## Changing the rules

Open `js/config.js` in Notepad, change the value, save, and refresh the page.

- **Gap limits:** `gapMinutes` (NP, MD, CM).
- **Empty block length:** `emptyBlockMinutes`.
- **How each shift type is handled:** `shiftTypePolicy`.
- **Timezone:** `timezone`. Use `'Etc/GMT+5'` for fixed EST all year.
- **If your times look shifted:** `sourceTimezone`. Times with no timezone are assumed to be UTC. If your export already shows Eastern clock times, set it to `'America/Toronto'`.
- **If your column names differ:** add the name to the matching list under `columns`. Capital letters and spaces do not matter.

## Putting it on GitHub (private)

1. On github.com choose **New repository**, give it a name, and choose **Private**.
2. Choose **uploading an existing file**, and drag in the files **inside** this folder (`index.html`, `css`, `js`, `docs`, `tools`, `tests`, `README.md`, `.gitignore`).
3. **Do not upload `my-data` or any CSV export.** The web upload ignores `.gitignore`, so check the file list before you commit.
4. To share with clinical leads, use **Settings > Collaborators** on the private repo.

**Do not turn on GitHub Pages for this repo.** Pages sites are public unless your organization has GitHub Enterprise. This tool is meant to be opened from your own computer.

## Not included yet

- **Automatic pulls** from Metabase, Slack, CHR and Humanity. For now you export CSVs. The "Other activity" slot already accepts Slack and CHR data. When your Slack admin access arrives, export the activity you need, keep any API keys out of this repo, and load the CSV.
- **More flags** (short or long video calls, very long or short consults, missing or late notes, no ownership, scheduled appointment outcomes, opened-chart-no-action, ON CM shifts). The structure in `js/core.js` makes each of these an added check on the same data.

## Troubleshooting

| What you see | What to do |
|---|---|
| "required column not found" | Add your column name in `js/config.js`, or ask the data team for that column |
| No provider found | Try part of the name, or the ID. Names only work if you loaded the Provider names file |
| "Is in the names file but has no shifts or encounters" | The person has a name on file but nothing in the exports for these files. Check the dates and the exports |
| Times look hours off | Change `sourceTimezone` in `js/config.js` |
| Few or no patients waiting | The encounters file may only contain this provider's encounters. It needs everyone's |
| "No scheduled shifts found" | The shifts file uses a different ID than the encounters file |
| Page is blank | Use Chrome or Edge, and make sure the `js` and `css` folders sit next to `index.html` |

## For developers

`node tests/run_tests.js` runs the checks on the flag logic (Node.js needed; not needed for normal use). `node tools/make_sample.js` regenerates the made-up sample data.

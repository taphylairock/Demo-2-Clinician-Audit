# What the audit tool needs from the master Metabase report

Please forward this page to the data team. The tool reads three CSV files. Column names do not have to match exactly (the tool matches common variants and the names can be added in `js/config.js`), but the **meaning** matters.

All timestamps should be full date and time. UTC or an offset (for example `2026-03-02T14:05:00Z`) is best. Pseudonymous IDs only: no names, no patient details.

## File 1: Encounters and consults (required)

One row per **provider per encounter** (every provider who touched the encounter gets their own row).
It must cover **every provider** for the dates, not only the provider being audited, because queue depth and the peer comparison are built from everyone's encounters.

| Column | Needed for |
|---|---|
| `practitioner_id` (required) | Finding the provider |
| `encounter_id` (required) | Counting consults and patients waiting |
| `role` (NP, MD or CM) | Gap limits per role |
| `locality` (province) | Patients waiting in the provider's province |
| `started_at` | When the patient entered the platform |
| `triaged_completed_at` | Splitting intake from triaged waiting |
| `medic_first_responded_at` | When the wait ended |
| `telecall_clinical_state_started_at` / `_ended_at` | NP and MD consult times |
| `ended_at` | Fallback consult end |
| `participant_joined_at` | Care manager activity |
| `secs_of_participants_activity` | Care manager engaged time |
| `intake_preference` (chat or video) | "No video call" flag |
| `video_call_started_at` **or** `had_video_call` | "No video call" flag |

### The care manager gap (important)
Care managers often message patients without taking ownership. `participant_joined_at` is the **last** time they joined, so a quick message at 5:15pm followed by closing the chart at 8:30pm looks like a three-hour stay. The tool does not count that span as work, and marks care manager results **low confidence**.

To make care manager flags reliable, the master report needs a **per-message** source: one row per message with `encounter_id`, `practitioner_id` (sender) and `sent_at`. Please ask whether that can be added.

**Provider name (optional, recommended):** add `practitioner_name` (or `practitioner_first_name` and `practitioner_last_name`) to this file and users can search by name with no extra file.

## File 2: Scheduled shifts (required)

One row per scheduled shift, for **all providers**.

| Column | Needed for |
|---|---|
| `practitioner_id` (required) | Finding the provider |
| `start_at`, `end_at` (required) | The paid window that is checked |
| `role` | Gap limits and peer comparison |
| `shift_type` | Words such as "On-call", "Training", "Admin" so those shifts are not flagged like regular shifts |
| `care_group_id` | Which province the provider worked in |

This can come from `dim_practitioner_worktimes` or from Humanity. If it includes `employee_name` or `practitioner_name`, that is also used for searching by name.

## File 3: Other activity (optional)

Slack, CHR or anything else with a person and a time. Adds markers to the timeline, so a reviewer can see what a provider was doing inside a flagged gap.

| Column | |
|---|---|
| `practitioner_id` (required) | Use the same ID as the other files (map Slack user IDs first) |
| `timestamp` (required) | |
| `source` | For example Slack or CHR |
| `event_type` | For example message_sent, chart_opened |

## File 4: Provider names (optional)

Only needed to search by name. Two columns, one row per provider. Keep it private.

| Column | |
|---|---|
| `practitioner_id` (required) | Same ID as the other files |
| `name` (required) | Full name. Alternatively `first_name` and `last_name` |

Names are never required in Files 1 to 3.

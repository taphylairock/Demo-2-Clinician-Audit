/*
  SETTINGS FILE: the only file you normally need to edit.
  Open it in Notepad (or any text editor), change a value, save, then refresh the page.

  1. TIMEZONE      - everything is shown in this timezone.
  2. THRESHOLDS    - the minute limits used by the flags.
  3. COLUMNS       - the column names in YOUR exports. Each line is:
                       internal_name: [ 'name in your file', 'another possible name' ]
                     If your export calls a column something different, add that name
                     to the list. Capital letters and spaces do not matter.
*/
(function (root) {
  var AUDIT_CONFIG = {

    // ---- 1. TIMEZONE ------------------------------------------------------
    // 'America/Toronto' follows Eastern time and switches between EST and EDT.
    // For fixed EST all year round (no daylight saving), use 'Etc/GMT+5'.
    timezone: 'America/Toronto',

    // Timestamps in your export that carry NO timezone (for example
    // "2026-03-02 14:05:00") are assumed to be in this zone. Metabase usually
    // stores UTC. If your export already shows Eastern clock times, change to
    // 'America/Toronto'.
    sourceTimezone: 'UTC',

    // ---- 2. THRESHOLDS ----------------------------------------------------
    thresholds: {
      // A gap between two consults inside a shift is flagged when it is LONGER than this.
      gapMinutes: { NP: 20, MD: 20, CM: 15, default: 20 },
      // Time at the start of a shift, the end of a shift, or a whole shift with
      // no consults is flagged as an "empty block" when it lasts at least this long.
      emptyBlockMinutes: 60,
      // When comparing to peers, another provider only counts if your shifts
      // overlapped by at least this many minutes.
      minPeerOverlapMinutes: 30
    },

    // What to do with each kind of shift:
    //   'flag'          = check for flags normally
    //   'flag-labelled' = check, but label the flag so a reviewer knows the context
    //   'suppress'      = show the shift on the timeline but raise no flags
    shiftTypePolicy: {
      regular: 'flag',
      admin: 'flag-labelled',
      'on-call': 'suppress',
      training: 'suppress'
    },

    // Words in the shift-type column that identify each kind of shift.
    shiftTypeKeywords: {
      'on-call': ['on call', 'on-call', 'oncall', 'on_call'],
      training: ['train', 'orientation', 'onboard'],
      admin: ['admin']
    },

    // Different ways your data may write each role. Matched in lower case.
    roleAliases: {
      NP: ['np', 'nurse practitioner', 'nurse_practitioner', 'nurse-practitioner'],
      MD: ['md', 'physician', 'doctor', 'gp', 'family physician'],
      CM: ['cm', 'care manager', 'care_manager', 'ca', 'care assistant', 'care_assistant']
    },

    // Values in the "intake preference" column that mean the patient asked for video.
    videoRequestedValues: ['video', 'video call', 'video_call', 'videocall'],
    trueValues: ['true', 't', 'yes', 'y', '1'],
    falseValues: ['false', 'f', 'no', 'n', '0'],

    // Names stay on screen only. Set to true if you also want a provider_name column
    // in the flags CSV you download. Leave false if that file will be shared or stored.
    includeNamesInCsv: false,

    // ---- 3. COLUMNS -------------------------------------------------------
    columns: {

      // One row per provider per encounter (a provider "touching" a consult).
      encounters: {
        practitioner_id:    ['practitioner_id', 'participant_practitioner_id', 'provider_id'],      // required
        encounter_id:       ['encounter_id'],                                                       // required
        role:               ['role', 'practitioner_role', 'practitioner_type', 'medic_type'],
        locality:           ['locality', 'province'],
        started_at:         ['started_at', 'encounter_started_at'],
        triaged_completed_at: ['triaged_completed_at'],
        first_responded_at: ['medic_first_responded_at', 'practitioner_medic_first_responded_at', 'first_responded_at'],
        clinical_start:     ['telecall_clinical_state_started_at', 'clinical_started_at'],
        clinical_end:       ['telecall_clinical_state_ended_at', 'clinical_ended_at'],
        ended_at:           ['ended_at', 'encounter_ended_at'],
        joined_at:          ['participant_joined_at'],
        secs_active:        ['secs_of_participants_activity'],
        intake_preference:  ['intake_preference', 'consult_preference', 'intake_modality'],
        video_started_at:   ['video_call_started_at', 'video_started_at'],
        had_video_call:     ['had_video_call', 'video_call_had', 'video_call_happened']
      },

      // Scheduled shifts (from dim_practitioner_worktimes or Humanity).
      shifts: {
        practitioner_id: ['practitioner_id', 'employee_id', 'provider_id'],                         // required
        start_at:        ['start_at', 'shift_start', 'start'],                                       // required
        end_at:          ['end_at', 'shift_end', 'end'],                                             // required
        role:            ['role', 'practitioner_role', 'position'],
        shift_type:      ['shift_type', 'type', 'schedule_type', 'shift_name'],
        care_group_id:   ['care_group_id', 'care_group', 'location']
      },

      // Optional list of provider names, used ONLY to search by name. Names are
      // never needed in the other files. Either one "name" column or first + last.
      directory: {
        practitioner_id: ['practitioner_id', 'provider_id', 'id'],                                   // required
        name:            ['name', 'full_name', 'practitioner_name', 'provider_name', 'display_name'],
        first_name:      ['first_name', 'firstname', 'given_name'],
        last_name:       ['last_name', 'lastname', 'surname', 'family_name']
      },

      // Optional extra activity (Slack, CHR, anything with a person and a time).
      events: {
        practitioner_id: ['practitioner_id', 'user_id', 'provider_id'],                              // required
        timestamp:       ['timestamp', 'ts', 'time', 'date_create', 'event_at'],                     // required
        source:          ['source', 'platform'],
        event_type:      ['event_type', 'action', 'type']
      }
    }
  };

  root.AUDIT_CONFIG = AUDIT_CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = AUDIT_CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);

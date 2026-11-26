// Written by the test `the_views_serve_sends_are_the_extensions_types` in
// tools/profile-builder/src/serve/tests/sim.rs, from views `serve` sends in its `dualInput/panel`,
// so tsc checks that each is a `ServerView` as panel/src/view.ts writes one, and from the Sync log's
// `dualInput/syncLog` and the boxes in `dualInput/values`, with every step the engine logs,
// so tsc checks each against sync-log/src/view.ts and boxes.ts, and each word against words.ts.
// cargo test writes it again, so edit the test, not this file.

import type { Update } from "../sync-log/src/view.ts"
import type { Values } from "./boxes.ts"
import type { ServerView } from "./bridge.ts"

export const VIEWS = {
  "not running": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "off",
      "lengthMs": null,
      "why": "no-flight"
    },
    "status": {
      "kind": "not-running"
    },
    "unpinned": false
  } satisfies ServerView,
  "another release": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "off",
      "lengthMs": null,
      "why": "no-flight"
    },
    "status": {
      "dualInput": "0.0.1",
      "extension": "0.1.0",
      "kind": "other-release",
      "update": "dual-input"
    },
    "unpinned": false
  } satisfies ServerView,
  "another window": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "off",
      "lengthMs": null,
      "why": "no-flight"
    },
    "status": {
      "kind": "other-window"
    },
    "unpinned": false
  } satisfies ServerView,
  "no session": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "off",
      "lengthMs": null,
      "why": "no-flight"
    },
    "status": {
      "kind": "no-session"
    },
    "unpinned": false
  } satisfies ServerView,
  "not in the flight": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "off",
      "lengthMs": null,
      "why": "no-flight"
    },
    "status": {
      "kind": "not-in-flight"
    },
    "unpinned": false
  } satisfies ServerView,
  "in a flight": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "empty"
    },
    "status": {
      "aircraft": "M Test",
      "crew": false,
      "kind": "in-flight",
      "runs": true
    },
    "unpinned": false
  } satisfies ServerView,
  "another aircraft's file": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "empty"
    },
    "status": {
      "aircraft": "M Test",
      "crew": false,
      "kind": "in-flight",
      "runs": false
    },
    "unpinned": false
  } satisfies ServerView,
  "Run, a lever with a crew and unsaved edits": {
    "body": {
      "kind": "run",
      "run": {
        "field": "0.5",
        "key": "battery",
        "live": [
          {
            "of": null,
            "value": "0.82"
          }
        ],
        "name": "Battery",
        "preview": {
          "actions": [
            {
              "apart": "2 frames",
              "does": "fire",
              "name": "K:HDG_INC",
              "times": 3,
              "values": []
            }
          ],
          "kind": "sends"
        },
        "refused": null,
        "revert": {
          "afterMs": 120,
          "to": "0"
        },
        "seen": [
          "0",
          "1"
        ],
        "takes": "value"
      }
    },
    "recorder": {
      "kind": "off",
      "lengthMs": null,
      "why": "crew"
    },
    "status": {
      "aircraft": "M Test",
      "crew": true,
      "kind": "in-flight",
      "runs": true
    },
    "unpinned": true
  } satisfies ServerView,
  "Run, an event, not building": {
    "body": {
      "kind": "run",
      "run": {
        "field": "",
        "key": "ap_master",
        "live": [
          {
            "carried": "1",
            "of": null,
            "value": "×3"
          }
        ],
        "name": "Autopilot master",
        "preview": {
          "kind": "error",
          "message": "Cannot find name 'valu'. Did you mean 'value'?",
          "where": "aircraft/test.yaml:16:12"
        },
        "refused": null,
        "revert": null,
        "seen": [],
        "takes": "event"
      }
    },
    "recorder": {
      "kind": "off",
      "lengthMs": null,
      "why": "unsaved"
    },
    "status": {
      "aircraft": "M Test",
      "crew": false,
      "kind": "in-flight",
      "runs": true
    },
    "unpinned": false
  } satisfies ServerView,
  "Run, a counting entry, pilot flying only": {
    "body": {
      "kind": "run",
      "run": {
        "field": "+3",
        "key": "com",
        "live": [
          {
            "of": "inc",
            "value": "×4"
          },
          {
            "error": true,
            "of": "dec",
            "value": "the sim refused it"
          }
        ],
        "name": "COM frequency",
        "preview": {
          "kind": "waiting"
        },
        "refused": null,
        "revert": null,
        "seen": "many",
        "takes": "steps"
      }
    },
    "recorder": {
      "kind": "empty"
    },
    "status": {
      "aircraft": "M Test",
      "crew": false,
      "kind": "in-flight",
      "runs": true
    },
    "unpinned": false
  } satisfies ServerView,
  "the picker": {
    "body": {
      "kind": "picker",
      "picker": {
        "active": "KX155B",
        "groups": [
          {
            "kind": "single",
            "row": {
              "fullKey": "GNS_DISABLED",
              "key": "GNS_DISABLED",
              "panels": 2,
              "ticked": true
            }
          },
          {
            "kind": "single",
            "row": {
              "fullKey": "KAS297B_1|Index=1",
              "key": "KAS297B_1",
              "panels": 1,
              "ticked": false
            }
          },
          {
            "identifier": "KX155B",
            "kind": "shared",
            "rows": [
              {
                "fullKey": "KX155B|Index=1",
                "key": "KX155B|Index=1",
                "panels": 1,
                "ticked": false
              },
              {
                "fullKey": "KX155B|Index=2",
                "key": "KX155B|Index=2",
                "panels": 1,
                "ticked": true
              }
            ]
          },
          {
            "kind": "single",
            "row": {
              "fullKey": "WasmInstrument|wasm_module=Gauge/TDSGTNXiGaugeModule.wasm&wasm_gauge=GTNXI750U1",
              "key": "WasmInstrument|wasm_module=Gauge/TDSGTNXiGaugeModule.wasm&wasm_gauge=GTNXI750U1",
              "panels": 1,
              "ticked": false
            }
          }
        ]
      }
    },
    "recorder": {
      "kind": "empty"
    },
    "status": {
      "aircraft": "M Test",
      "crew": false,
      "kind": "in-flight",
      "runs": true
    },
    "unpinned": false
  } satisfies ServerView,
  "adding an aircraft, with no session": {
    "body": {
      "add": {
        "cover": {
          "by": "folder",
          "variant": "a"
        },
        "folder": "test-aircraft",
        "named": {
          "folder": "a",
          "preset": null
        },
        "preset": "test-aircraft/presets/test/skis",
        "suggested": {
          "folder": "aircraft",
          "preset": "skis"
        },
        "title": "Test Aircraft Skis",
        "variants": [
          "a"
        ]
      },
      "kind": "add"
    },
    "recorder": {
      "kind": "off",
      "lengthMs": null,
      "why": "no-flight"
    },
    "status": {
      "kind": "no-session"
    },
    "unpinned": false
  } satisfies ServerView,
  "in a flight, no profile": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "off",
      "lengthMs": null,
      "why": "no-flight"
    },
    "status": {
      "crew": false,
      "kind": "no-profile",
      "title": "Test Aircraft"
    },
    "unpinned": false
  } satisfies ServerView,
  "recording": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "elapsedMs": 12000,
      "kind": "recording"
    },
    "status": {
      "aircraft": "M Test",
      "crew": false,
      "kind": "in-flight",
      "runs": true
    },
    "unpinned": false
  } satisfies ServerView,
  "recorded, stopped by a join": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "recorded",
      "lengthMs": 42000,
      "stopped": {
        "by": {
          "kind": "joined",
          "who": "James"
        },
        "what": "playback"
      }
    },
    "status": {
      "aircraft": "M Test",
      "crew": false,
      "kind": "in-flight",
      "runs": true
    },
    "unpinned": false
  } satisfies ServerView,
  "restoring": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "putting-back",
      "lengthMs": 42000
    },
    "status": {
      "aircraft": "M Test",
      "crew": false,
      "kind": "in-flight",
      "runs": true
    },
    "unpinned": false
  } satisfies ServerView,
  "playing": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "atMs": 15000,
      "kind": "playing",
      "lengthMs": 42000
    },
    "status": {
      "aircraft": "M Test",
      "crew": false,
      "kind": "in-flight",
      "runs": true
    },
    "unpinned": false
  } satisfies ServerView,
  "recorded, reloading after a save": {
    "body": {
      "kind": "nothing"
    },
    "recorder": {
      "kind": "off",
      "lengthMs": 42000,
      "why": "loading"
    },
    "status": {
      "aircraft": "M Test",
      "crew": false,
      "kind": "in-flight",
      "runs": true
    },
    "unpinned": false
  } satisfies ServerView,
}

export const SYNC_LOG = {
  "first": 0,
  "rows": [
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_1",
      "id": 0,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "sent"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "sent"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_2",
      "id": 1,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "replaced"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "replaced"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_3",
      "id": 2,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": "lost",
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "withdrawn"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "withdrawn"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_4",
      "id": 3,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": "undone",
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "withdrawn"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "withdrawn"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_5",
      "id": 4,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "not-sent-during-preflight"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "not-sent-during-preflight"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_6",
      "id": 5,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "put-back"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "put-back"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_7",
      "id": 6,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "put-back-carries-on"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "put-back-carries-on"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_8",
      "id": 7,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "matches-synced-value"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "matches-synced-value"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_9",
      "id": 8,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "not-sent"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "not-sent"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_10",
      "id": 9,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "5000 bytes",
          "links": [],
          "ms": 0,
          "word": "too-large"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "too-large"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_11",
      "id": 10,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": "driven",
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "stopped"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "stopped"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_12",
      "id": 11,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "the write function ran past 100ms",
          "links": [],
          "ms": 0,
          "word": "stopped"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "stopped"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_13",
      "id": 12,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "Unexpected token",
          "links": [],
          "ms": 0,
          "word": "stopped"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "stopped"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_14",
      "id": 13,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "reported-twice"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "reported-twice"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_15",
      "id": 14,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "K('TOGGLE_FLIGHT_DIRECTOR')",
          "links": [],
          "ms": 0,
          "word": "ignored"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "ignored"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_16",
      "id": 15,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "lost"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "lost"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_17",
      "id": 16,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "won"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "won"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_18",
      "id": 17,
      "notes": [
        {
          "kind": "unloaded"
        }
      ],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "compared"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "compared"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_19",
      "id": 18,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "matches"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "matches"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_20",
      "id": 19,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "differs"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "differs"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_21",
      "id": 20,
      "notes": [
        {
          "kind": "unloaded"
        }
      ],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "waits-for-first-reading"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "waits-for-first-reading"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_22",
      "id": 21,
      "notes": [
        {
          "kind": "unloaded"
        }
      ],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "first-reading"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "first-reading"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_23",
      "id": 22,
      "notes": [
        {
          "kind": "unloaded"
        }
      ],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "battery",
          "links": [
            "battery"
          ],
          "ms": 0,
          "word": "waits-for"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "waits-for"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_24",
      "id": 23,
      "notes": [
        {
          "kind": "unloaded"
        }
      ],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "now-reads"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "now-reads"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_25",
      "id": 24,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "already-matches"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "already-matches"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_26",
      "id": 25,
      "notes": [
        {
          "kind": "unloaded"
        }
      ],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "K('AP_MASTER') 1",
          "links": [],
          "ms": 0,
          "word": "writes"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "writes"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_27",
      "id": 26,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "ReferenceError: valu is not defined",
          "links": [],
          "ms": 0,
          "word": "function-failed"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "function-failed"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_28",
      "id": 27,
      "notes": [
        {
          "kind": "unloaded"
        }
      ],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "pending"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "pending"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_29",
      "id": 28,
      "notes": [
        {
          "kind": "unloaded"
        }
      ],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "read-back"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "read-back"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_30",
      "id": 29,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": "landed",
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "read-back"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "landed"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_31",
      "id": 30,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "never-landed"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "never-landed"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_32",
      "id": 31,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "warning-skipped"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "warning-skipped"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_33",
      "id": 32,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "token-used"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "token-used"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_34",
      "id": 33,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "token-expired"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "token-expired"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_35",
      "id": 34,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "K('TOGGLE_FLIGHT_DIRECTOR')",
          "links": [],
          "ms": 0,
          "word": "ignore-expired"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "ignore-expired"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_36",
      "id": 35,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "no-value"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "no-value"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_37",
      "id": 36,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "dropped-refused"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "dropped-refused"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_38",
      "id": 37,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "shadow-restored"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "shadow-restored"
    },
    {
      "cause": {
        "from": "Ana",
        "kind": "arrived",
        "playback": false
      },
      "entry": "entry_39",
      "id": 38,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "arrived"
        },
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "skipped-stopped"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "skipped-stopped"
    },
    {
      "cause": {
        "kind": "local-change"
      },
      "entry": "entry_40",
      "id": 39,
      "notes": [
        {
          "kind": "ran",
          "ms": 0
        },
        {
          "kind": "unloaded"
        }
      ],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "local-change"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "local-change"
    },
    {
      "cause": {
        "from": null,
        "kind": "catch-up",
        "playback": true
      },
      "entry": "entry_41",
      "id": 40,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "catch-up"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "catch-up"
    },
    {
      "cause": {
        "kind": "control-passed"
      },
      "entry": "entry_42",
      "id": 41,
      "notes": [],
      "open": false,
      "steps": [
        {
          "also": null,
          "detail": "1",
          "links": [],
          "ms": 0,
          "word": "control-passed"
        }
      ],
      "time": 0,
      "value": "1",
      "verdict": "control-passed"
    },
    {
      "cause": {
        "kind": "local-change"
      },
      "entry": "battery",
      "id": 42,
      "notes": [],
      "open": true,
      "steps": [
        {
          "also": null,
          "detail": null,
          "links": [],
          "ms": 0,
          "word": "local-change"
        }
      ],
      "time": 0,
      "value": null,
      "verdict": "local-change"
    }
  ]
} satisfies Update

export const BOXES = {
  "boxes": [
    {
      "kind": "value",
      "line": 0,
      "text": "1"
    }
  ],
  "uri": "file:///c%3A/profiles/aircraft/test.yaml"
} satisfies Values

// Written by the test `the_views_serve_sends_are_the_extensions_types` in
// tools/profile-builder/src/serve/tests/sim.rs, from views `serve` sends in its `dualInput/panel`,
// so tsc checks that each is a `ServerView` as panel/src/view.ts writes one. cargo test writes it
// again, so edit the test, not this file.

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
              "refused": null,
              "ticked": true
            }
          },
          {
            "kind": "single",
            "row": {
              "fullKey": "KAS297B_1|Index=1",
              "key": "KAS297B_1",
              "panels": 1,
              "refused": null,
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
                "refused": null,
                "ticked": false
              },
              {
                "fullKey": "KX155B|Index=2",
                "key": "KX155B|Index=2",
                "panels": 1,
                "refused": null,
                "ticked": true
              }
            ]
          },
          {
            "kind": "single",
            "row": {
              "fullKey": "WasmInstrument|wasm_module=Gauge/TDSGTNXiGaugeModule.wasm&wasm_gauge=GTNXI750U1",
              "key": "WasmInstrument",
              "panels": 1,
              "refused": "wasm-instrument",
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

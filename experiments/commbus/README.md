# CommBus probes

The probes for [the CommBus plan](../../record/commbus/plan.md), which says what each one is for.
Each saves its report to `record/commbus/results/`.

All of them need MSFS 2024 in a flight with the Synaptic A220-300 and its panels powered.
Run them from the repository root with Node 22, which needs no packages installed.

| Probe | Stage | Changes the panel | Command |
| --- | --- | --- | --- |
| `p01-commbus-source.mjs` | 1 | No | `node experiments/commbus/p01-commbus-source.mjs` |

To see which panels the inspector can reach, and their ids:

```bash
node experiments/tools/run.mjs pages VCockpit
```

If that prints the message about nothing answering on 127.0.0.1:19999, the sim isn't in a flight yet, or another process holds the port.

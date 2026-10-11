# Formal models

TLA+ models of protocols whose correctness depends on interleavings that unit tests
reach only by luck. Each model names the source it describes; change the two together.

| Model                                  | Describes                                                                                            | Checks                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [MemoryCapture.tla](MemoryCapture.tla) | Turn capture, the capture cursor and the background extraction worker in `src/services/memory/core/` | A window is applied at most once; nothing said while memory was off is captured; a rewound turn leaves the past-turn index; every turn closed with memory on is eventually indexed and extracted |

## Running

Download `tla2tools.jar` from the [TLA+ releases](https://github.com/tlaplus/tlaplus/releases)
and run TLC from this directory with Java 17 or newer:

```sh
java -cp tla2tools.jar tlc2.TLC -deadlock -config MemoryCapture.cfg MemoryCapture.tla
```

`-deadlock` is needed because a bounded run ends in states with nothing left to do.
`MemoryCapture.cfg` checks the shipped design (`Design = "fixed"`, two concurrent drains,
three turns, two memory toggles, one app kill, one rewind: 47,415 distinct states, all
properties hold). Set `Design = "racy"` to reproduce the double extraction the model found
when a drain marked itself running only after awaiting the model.

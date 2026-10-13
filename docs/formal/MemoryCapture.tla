---------------------------- MODULE MemoryCapture ----------------------------
(***************************************************************************)
(* Memory v2 capture for one chat thread (src/services/memory/core/).      *)
(*                                                                         *)
(* A closed turn is indexed as a past turn and queues the thread for       *)
(* background extraction (publishConversationTurnMemory). The capture      *)
(* cursor records how far indexing and extraction have read. A launch      *)
(* catches up on turns closed while the app was killed; turning memory on  *)
(* moves both marks past everything said while it was off; a rewound turn  *)
(* leaves the index. A turn can leave the thread's live messages for the   *)
(* transcript archive (the history window, a context reset) and stays in   *)
(* the index. Extraction runs in drains: a drain checks that no run is in  *)
(* flight, awaits the model (an interleaving point), reads the cursor,     *)
(* calls the model and applies the window with the cursor advance in one   *)
(* transaction. Several drains can start: one per schedule, one per idle   *)
(* wait, one per retry/poll timer.                                         *)
(*                                                                         *)
(* Design = "fixed": the drain marks itself running in the same step as    *)
(*   the check (memoryExtractionWorker.ts).                                *)
(* Design = "racy": the drain marks itself running only after the model    *)
(*   resolved. Two drains then extract the same window and AppliedOnce     *)
(*   fails (TLC finds it in 11 steps); kept as the regression model.       *)
(* Source = "index": a drain reads its window from the past-turn index     *)
(*   (memoryExtraction.ts).                                                *)
(* Source = "thread": a drain reads the thread's live messages. A turn     *)
(*   evicted before extraction ran is then never extracted and             *)
(*   EventuallyCaptured fails (TLC finds the lasso in 12 states); kept as  *)
(*   the regression model.                                                 *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Design, Source, Drains, MaxTurns, MaxToggles, MaxKills, MaxRewinds, MaxEvictions

VARIABLES
    turns,            \* turn ids used so far (ids only grow; a rewound id is never reused)
    closedOn,         \* closedOn[t]: memory was on when turn t closed
    rewound,          \* rewound[t]: turn t was rewound (gone from the thread)
    memOn,            \* the memory setting
    alive,            \* the app process is running
    foreground,       \* a foreground turn holds the model
    indexed,          \* turns in the past-turn index
    indexedThrough,   \* cursor: turns <= this were indexed (or skipped)
    extractedThrough, \* cursor: extraction read turns <= this (or skipped them)
    applied,          \* applied[t]: times turn t's operations were applied
    pending,          \* the thread is queued for extraction
    pendingThrough,   \* ... through this turn
    running,          \* the worker's in-flight flag
    pc,               \* pc[d] \in {"idle", "check", "resolving", "calling"}
    readFrom,         \* readFrom[d]: cursor value drain d read
    readTo,           \* readTo[d]: the turn drain d extracts through
    optInAt,          \* turns closed when memory was last turned on (0: never turned off)
    toggles, kills, rewinds,
    evicted,          \* evicted[t]: turn t left the live thread for the transcript archive
    evictions

vars == <<turns, closedOn, rewound, memOn, alive, foreground, indexed, indexedThrough,
          extractedThrough, applied, pending, pendingThrough, running, pc, readFrom, readTo,
          optInAt, toggles, kills, rewinds, evicted, evictions>>

Turns == 1..MaxTurns
Present(t) == t <= turns /\ ~rewound[t]
LastPresent == IF \E t \in 1..turns : Present(t)
               THEN CHOOSE t \in 1..turns : Present(t) /\ \A u \in (t+1)..turns : ~Present(u)
               ELSE 0
Max(a, b) == IF a > b THEN a ELSE b
\* A turn still among the thread's live messages (not rewound, not evicted to the archive).
Live(t) == Present(t) /\ ~evicted[t]
\* What a drain can read for turn t: the live thread, or the past-turn index.
Readable(t) == IF Source = "thread" THEN Live(t) ELSE t \in indexed

Init ==
    /\ turns = 0
    /\ closedOn = [t \in Turns |-> FALSE]
    /\ rewound = [t \in Turns |-> FALSE]
    /\ memOn = TRUE /\ alive = TRUE /\ foreground = FALSE
    /\ indexed = {} /\ indexedThrough = 0 /\ extractedThrough = 0
    /\ applied = [t \in Turns |-> 0]
    /\ pending = FALSE /\ pendingThrough = 0 /\ running = FALSE
    /\ pc = [d \in Drains |-> "idle"]
    /\ readFrom = [d \in Drains |-> 0] /\ readTo = [d \in Drains |-> 0]
    /\ optInAt = 0 /\ toggles = 0 /\ kills = 0 /\ rewinds = 0
    /\ evicted = [t \in Turns |-> FALSE] /\ evictions = 0

\* Any idle drain slot starts a drain (schedule, idle wait, timer).
SpawnDrain(d) ==
    /\ alive /\ pc[d] = "idle"
    /\ pc' = [pc EXCEPT ![d] = "check"]
    /\ UNCHANGED <<optInAt, turns, closedOn, rewound, memOn, alive, foreground, indexed,
                   indexedThrough, extractedThrough, applied, pending, pendingThrough,
                   running, readFrom, readTo, toggles, kills, rewinds, evicted, evictions>>

\* The user sends a message; the foreground turn preempts a running extraction.
StartForeground ==
    /\ alive /\ ~foreground /\ turns < MaxTurns
    /\ foreground' = TRUE
    /\ pc' = [d \in Drains |-> IF pc[d] = "calling" THEN "idle" ELSE pc[d]]
    /\ running' = IF \E d \in Drains : pc[d] = "calling" THEN FALSE ELSE running
    /\ UNCHANGED <<optInAt, turns, closedOn, rewound, memOn, alive, indexed, indexedThrough,
                   extractedThrough, applied, pending, pendingThrough, readFrom, readTo,
                   toggles, kills, rewinds, evicted, evictions>>

\* The turn closes; with memory on it is indexed and the thread is queued.
CloseTurn ==
    /\ alive /\ foreground
    /\ LET t == turns + 1 IN
        /\ turns' = t
        /\ closedOn' = [closedOn EXCEPT ![t] = memOn]
        /\ IF memOn
           THEN /\ indexed' = indexed \cup {t}
                /\ indexedThrough' = Max(indexedThrough, t)
                /\ pending' = TRUE /\ pendingThrough' = t
           ELSE UNCHANGED <<indexed, indexedThrough, pending, pendingThrough, evicted, evictions>>
    /\ foreground' = FALSE
    /\ UNCHANGED <<optInAt, rewound, memOn, alive, extractedThrough, applied, running, pc, readFrom,
                   readTo, toggles, kills, rewinds, evicted, evictions>>

\* The drain's synchronous check.
DrainCheck(d) ==
    /\ pc[d] = "check"
    /\ IF running \/ ~pending \/ foreground
       THEN /\ pc' = [pc EXCEPT ![d] = "idle"] /\ UNCHANGED running
       ELSE /\ pc' = [pc EXCEPT ![d] = "resolving"]
            /\ running' = IF Design = "fixed" THEN TRUE ELSE running
    /\ UNCHANGED <<optInAt, turns, closedOn, rewound, memOn, alive, foreground, indexed,
                   indexedThrough, extractedThrough, applied, pending, pendingThrough,
                   readFrom, readTo, toggles, kills, rewinds, evicted, evictions>>

\* The model resolved; the drain reads the cursor and calls the model.
DrainResolve(d) ==
    /\ pc[d] = "resolving"
    /\ running' = TRUE
    /\ readFrom' = [readFrom EXCEPT ![d] = extractedThrough]
    /\ readTo' = [readTo EXCEPT ![d] = pendingThrough]
    /\ pc' = [pc EXCEPT ![d] = "calling"]
    /\ UNCHANGED <<optInAt, turns, closedOn, rewound, memOn, alive, foreground, indexed,
                   indexedThrough, extractedThrough, applied, pending, pendingThrough,
                   toggles, kills, rewinds, evicted, evictions>>

\* The model replied: apply the window read and advance the cursor in one transaction.
DrainCommit(d) ==
    /\ pc[d] = "calling"
    /\ applied' = [t \in Turns |->
                    IF t > readFrom[d] /\ t <= readTo[d] /\ Readable(t)
                    THEN applied[t] + 1 ELSE applied[t]]
    /\ extractedThrough' = readTo[d]
    /\ pending' = (pendingThrough > readTo[d])
    /\ running' = FALSE
    /\ pc' = [pc EXCEPT ![d] = "idle"]
    /\ UNCHANGED <<optInAt, turns, closedOn, rewound, memOn, alive, foreground, indexed,
                   indexedThrough, pendingThrough, readFrom, readTo, toggles, kills, rewinds, evicted, evictions>>

\* Turning memory off cancels extraction; turning it on skips what was said meanwhile.
ToggleMemory ==
    /\ alive /\ toggles < MaxToggles
    /\ toggles' = toggles + 1
    /\ memOn' = ~memOn
    /\ IF memOn
       THEN /\ pending' = FALSE /\ running' = FALSE
            /\ pc' = [d \in Drains |-> "idle"]
            /\ UNCHANGED <<indexedThrough, extractedThrough, optInAt, evicted, evictions>>
       ELSE /\ indexedThrough' = Max(indexedThrough, turns)
            /\ extractedThrough' = Max(extractedThrough, turns)
            /\ optInAt' = turns
            /\ UNCHANGED <<pending, running, pc, evicted, evictions>>
    /\ UNCHANGED <<turns, closedOn, rewound, alive, foreground, indexed, applied,
                   pendingThrough, readFrom, readTo, kills, rewinds, evicted, evictions>>

\* The OS kills the app: in-memory queue and drains are gone.
Kill ==
    /\ alive /\ kills < MaxKills
    /\ kills' = kills + 1
    /\ alive' = FALSE /\ foreground' = FALSE
    /\ pending' = FALSE /\ running' = FALSE /\ pc' = [d \in Drains |-> "idle"]
    /\ UNCHANGED <<optInAt, turns, closedOn, rewound, memOn, indexed, indexedThrough,
                   extractedThrough, applied, pendingThrough, readFrom, readTo, toggles,
                   rewinds, evicted, evictions>>

\* A launch catches up: index closed turns after the mark, queue extraction if behind.
Launch ==
    /\ ~alive
    /\ alive' = TRUE
    /\ IF memOn
       THEN /\ indexed' = indexed \cup {t \in 1..turns : Live(t) /\ t > indexedThrough}
            /\ indexedThrough' = Max(indexedThrough, LastPresent)
            /\ pending' = (LastPresent > extractedThrough)
            /\ pendingThrough' = LastPresent
       ELSE UNCHANGED <<indexed, indexedThrough, pending, pendingThrough, evicted, evictions>>
    /\ UNCHANGED <<optInAt, turns, closedOn, rewound, memOn, foreground, extractedThrough, applied,
                   running, pc, readFrom, readTo, toggles, kills, rewinds, evicted, evictions>>

\* The user rewinds the latest turn to resend it: it leaves the thread and the index.
Rewind ==
    /\ alive /\ ~foreground /\ rewinds < MaxRewinds /\ LastPresent > 0
    /\ ~evicted[LastPresent]
    /\ rewinds' = rewinds + 1
    /\ rewound' = [rewound EXCEPT ![LastPresent] = TRUE]
    /\ indexed' = indexed \ {LastPresent}
    /\ UNCHANGED <<optInAt, turns, closedOn, memOn, alive, foreground, indexedThrough,
                   extractedThrough, applied, pending, pendingThrough, running, pc, readFrom,
                   readTo, toggles, kills, evicted, evictions>>

\* The oldest live turn leaves the thread's live messages for the transcript archive (the
\* history window, or the user resetting the context); it stays in the past-turn index.
Evict ==
    /\ alive /\ evictions < MaxEvictions /\ \E t \in 1..turns : Live(t)
    /\ LET t == CHOOSE t \in 1..turns : Live(t) /\ \A u \in 1..(t-1) : ~Live(u) IN
         evicted' = [evicted EXCEPT ![t] = TRUE]
    /\ evictions' = evictions + 1
    /\ UNCHANGED <<optInAt, turns, closedOn, rewound, memOn, alive, foreground, indexed,
                   indexedThrough, extractedThrough, applied, pending, pendingThrough, running,
                   pc, readFrom, readTo, toggles, kills, rewinds>>

Next ==
    \/ \E d \in Drains : SpawnDrain(d) \/ DrainCheck(d) \/ DrainResolve(d) \/ DrainCommit(d)
    \/ StartForeground \/ CloseTurn \/ ToggleMemory \/ Kill \/ Launch \/ Rewind \/ Evict

Spec == Init /\ [][Next]_vars
        /\ WF_vars(CloseTurn) /\ WF_vars(Launch)
        /\ \A d \in Drains : WF_vars(SpawnDrain(d)) /\ WF_vars(DrainCheck(d))
                             /\ WF_vars(DrainResolve(d)) /\ WF_vars(DrainCommit(d))

\* S1: a window's operations are applied at most once.
AppliedOnce == \A t \in Turns : applied[t] <= 1

\* S2: nothing said while memory was off is ever captured.
NothingCapturedWhileOff ==
    \A t \in Turns : (t <= turns /\ ~closedOn[t]) => (t \notin indexed /\ applied[t] = 0)

\* S3: a rewound turn is not in the past-turn index.
RewoundNotIndexed == \A t \in Turns : rewound[t] => t \notin indexed

\* L1: once the app stays alive with memory on, every present turn closed with memory on is
\* indexed, and extracted unless it closed before memory was last turned on (turning memory
\* off drops extraction that had not run yet).
Captured ==
    \A t \in 1..turns :
        (Present(t) /\ closedOn[t]) => (t \in indexed /\ (t > optInAt => applied[t] >= 1))
EventuallyCaptured == <>[](alive /\ memOn /\ ~foreground) => <>[]Captured
=============================================================================

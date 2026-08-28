# Guarded Original-Repository Mutation Safety Case

Status: Phase 31 design/qualification evidence only
Decision: **NO-GO for original-repository apply authority**

This document evaluates what must be true before gitinspect may ever mutate the repository represented by the existing repository session. It does not authorize an apply command, add a second transaction path, or change the production preview-only UI/Tauri boundary.

## 1. Existing boundary

The current mutation studio is copy-only:

- the renderer authors ordered typed operations;
- `TransactionManager` defaults to `targetMode: "copy"`;
- the Git mutation adapter rejects any target other than `copy`;
- Tauri registers create/preview/confirm/cancel only;
- Rust executes mutation operations in a disposable clone;
- the original repository has no apply command;
- the rendered Apply control remains disabled.

The existing graph `revision` remains a **structural refresh fingerprint**, not a destructive-mutation freshness token. It covers resolved/symbolic HEAD, refs/upstreams, remotes and hook **names**. It intentionally omits canonical repository filesystem identity, index bytes/state, worktree bytes/state, repository config bytes, hook contents and any authorization state.

Phase 27 proved the preview path natively. That evidence is necessary for this safety review, but it is not sufficient to widen authority.

## 2. Safety decision

A future original apply remains blocked even when the stronger Phase-28 preflight says the repository is fresh.

The following boundaries are still unresolved and are represented directly by `MutationApplyUnresolvedBoundary`:

1. `backend-owned-single-use-authorization`
2. `durable-idempotency-replay-ledger`
3. `race-free-final-preflight-and-effect`
4. `crash-safe-atomicity-or-recovery`
5. `config-and-external-execution-isolation`

`MutationPreflightAssessment.original_apply_authorized` is therefore always `false` in Phase 28. No caller can convert a successful read-only assessment into mutation authority by implication.

## 3. Stronger freshness model

`MutationPreflightSnapshot` is deliberately separate from `GitRepositorySnapshot::revision`; refresh/cache semantics must not be silently redefined as destructive-write semantics.

| State | Phase-28 evidence | Fail-closed rule |
| --- | --- | --- |
| Repository identity | canonical repository/worktree path, git-dir, common-dir plus device, inode and owner UID | any identity change rejects; platforms without strong device/inode/owner identity are outside the qualified model |
| Bare/worktree topology | explicit `bare` bit | bare repositories are outside the qualified model |
| HEAD | resolved OID plus symbolic referent | any change rejects |
| Refs | exact sorted name, target OID, symbolic target and upstream | any change rejects |
| Structural graph state | existing `revision` retained as one component | any change rejects |
| Index bytes | SHA-256 of raw per-worktree index bytes, or explicit `absent` | byte/state change rejects |
| HEAD ↔ index state | gix tree/index status | must be clean before receipt; later change rejects |
| Index ↔ worktree state | gix status with individual untracked files and submodule execution disabled | must be clean before receipt; later dirty state rejects |
| Dirty-path presentation | first 32 unique paths, with truncation bit | display is bounded; rejection is not |
| Local config bytes | common `config` + per-worktree `config.worktree` fingerprints | byte change rejects |
| Config includes | resolved presence of `include` / `includeIf` | fail closed; external included bytes are not claimed as covered |
| Hooks | common hook names plus regular-file/symlink bytes/targets; samples ignored | any active hook or custom `core.hooksPath` is fail closed |
| Whole source state | domain-separated SHA-256 `stateDigest`, including bounded dirty-path presentation/truncation state | receipt binds the exact captured state represented by the snapshot |

### 3.1 Read-only capture

The collector uses repository discovery, filesystem reads and gix status only. It never calls the gix status write-back path. Critical index/config paths are rejected if they are symlinks instead of being followed implicitly.

Capture is performed twice and both complete snapshots must compare equal. This rejects a torn read in which, for example, refs are observed before a concurrent mutation and index/config/hook state afterward. Canonical identity paths are also checked with non-following metadata after canonicalization; the qualified model requires device/inode/owner identity rather than path strings alone.

This still does not make pathname resolution an atomic filesystem capability: a hostile mount/path replacement racing canonicalization and metadata acquisition is not proven impossible. The double-read and identity tuple make ordinary concurrent replacement fail closed, but a future destructive executor must use stronger handle/lock semantics where needed. This remains part of the final TOCTOU blocker.

This double-read is **not** claimed to solve the final TOCTOU problem. An external process can still change the repository after the last read and before a hypothetical mutation effect. Any future apply design must close or safely tolerate that boundary; Phase 28 keeps it unresolved.

### 3.2 Worktree byte semantics

A clean worktree is stronger than merely hashing path names:

- exact index bytes are fingerprinted;
- HEAD-to-index must have no changes;
- index-to-worktree must have no tracked modifications;
- untracked files are included and make the worktree dirty.

For a receipt to exist, tracked worktree bytes must therefore agree with the exact index object/mode state and no untracked state may exist. Dirty content itself does not need to be promoted into a trusted digest because every dirty state is rejected.

## 4. Preview/result binding

`MutationPreflightReceipt::bind_confirmed_preview` verifies the already-existing preview identity contract before producing safety evidence:

- successful preview and zero failures;
- preview `baseRevision == source.structuralRevision`;
- canonical operation list in exact caller order;
- recomputed existing operation digest;
- preview token bound to sandbox ID + transaction ID + base revision + operation digest;
- confirmation token bound to sandbox ID + transaction ID + preview token;
- a separate digest of the complete preview result identity, including before/after summaries, changed refs, rewritten commits, hash cascade, warnings and failures.

The receipt binds:

```text
source state digest
  + sandbox identity
  + transaction identity
  + base structural revision
  + canonical ordered operations / operation digest
  + preview token
  + confirmation token
  + preview result digest
```

The existing preview and confirmation tokens are deterministic hashes. They are useful integrity/identity labels and are backend-checked within the preview session, but they are **not secrets** and must not be treated as a future apply authorization capability.

## 5. Authorization boundary

A future original apply must require a new backend-owned authorization concept rather than reinterpret the current confirmation token.

Minimum properties for a later design:

- generated/stored only by the backend after explicit user confirmation;
- cryptographically unpredictable or otherwise unforgeable across the renderer boundary;
- bound to repository identity, strong source-state digest, transaction ID, operation digest, preview result digest and explicit target mode `original`;
- single-use;
- consumed under the same backend critical section that begins final preflight/effect handling;
- never accepted by the copy-preview commands as interchangeable state;
- renderer possession alone must not establish authority.

Phase 28 intentionally implements none of that authority.

## 6. Idempotency and replay

A future destructive command needs a backend-owned durable attempt record. An in-memory `confirmed` boolean or renderer state is insufficient.

Required semantics:

```text
new authorization + new attempt id
    -> atomically reserve/record attempt before first original effect
    -> exactly one terminal outcome record

same authorization or same attempt id again
    -> reject as replay

process restart with an in-progress attempt
    -> do not retry automatically
    -> enter explicit recovery/reinspection flow
```

The safe default after uncertainty is **no replay** and a fresh repository inspection, not “try the mutation again.”

## 7. Race model

### Covered by Phase 28 evidence

- structural source change between preview and confirmation is already rejected by the preview manager;
- worktree/index-only changes that structural `revision` misses are rejected by the stronger preflight;
- config/hook/ref/HEAD/repository-identity changes are reported specifically;
- two identical captures are required so a changing source cannot produce a torn receipt silently;
- preview/sandbox/result identity substitution is rejected.

### Not covered; remains a blocker

There is no lock in Phase 28 spanning:

```text
final strong preflight
    -> authorization consumption
    -> all original-repository effects
    -> durable terminal outcome
```

The existing repository authority mutex protects its own session bookkeeping; it does not lock out an external Git process. Git ref locks can protect individual ref updates, but that alone does not make a multi-step rewrite plus index/worktree update atomic.

A future design must either provide a race-safe execution strategy or narrow the authorized operation set to effects for which atomicity can actually be demonstrated.

## 8. Hooks, config and external execution

Phase 28 uses the conservative policy:

- any active repository hook: reject;
- custom `core.hooksPath`: reject;
- repository `include` / `includeIf`: reject;
- repository-local/common and per-worktree config bytes: bind into freshness evidence.

System/global Git configuration and process environment are **not** claimed as byte-for-byte covered by the Phase-28 local config fingerprint. They can affect Git behavior independently, so a future executor must either run with an explicitly isolated/config-sanitized environment or bind/validate all effective inputs before authority can be considered.

This is still not a complete execution-isolation proof. Git operations can be influenced by configuration and attributes beyond hooks, including filters, signing, editors and helpers. A future execution engine must prove that original mutation cannot launch repository-controlled programs, or define and qualify an explicit deny/fail-closed policy. Until then `config-and-external-execution-isolation` remains unresolved.

## 9. Crash and partial-effect boundary

The current preview backend is safe because the disposable copy can be destroyed. Original-repository mutation does not have that escape hatch.

Potential rewrite operations can create commits and move refs; a crash can occur between those effects. Index/worktree effects add another independently mutable state plane. Therefore “preflight was fresh” is not an atomicity argument.

Before original apply can be considered:

- each operation class must have a documented effect boundary;
- ref updates must use an atomic ref transaction where possible;
- object creation must be safe if left unreachable;
- index/worktree handling must be either atomic/rollback-qualified or excluded;
- an interrupted attempt must be detectable after restart;
- recovery must be explicit and must never replay a partially completed rewrite automatically.

Phase 28 records this as `crash-safe-atomicity-or-recovery` and does not implement an executor.

## 10. User-visible failure taxonomy

`MutationPreflightFailureCode` keeps failures specific instead of collapsing every case into “stale”:

| Code | User-visible meaning |
| --- | --- |
| `repository-identity-changed` | selected repository/git-dir/common-dir identity or ownership changed |
| `structural-revision-changed` | graph/ref structural state changed |
| `head-changed` | resolved or symbolic HEAD changed |
| `ref-targets-changed` | exact ref targets/upstreams changed |
| `index-state-changed` | raw index bytes or HEAD-to-index cleanliness changed |
| `worktree-state-changed` | worktree/index cleanliness changed; bounded changed paths are shown |
| `config-changed` | local config bytes/include policy changed |
| `hooks-changed` | hook bytes/names/path policy changed |
| `preview-binding-changed` | sandbox/transaction/order/digest/token/result identity changed |

Capture-time failures (identity replacement, critical metadata symlink, concurrent capture change, dirty source, hooks/config policy) are returned as explicit `MutationPreflightError` reasons.

## 11. Qualification evidence

`crates/gitinspect-core/tests/mutation_preflight.rs` qualifies the model on deterministic repository-local fixtures without mutating the gitinspect repository under test.

Covered cases:

- worktree byte change with unchanged structural `revision`;
- staged/index change with unchanged structural `revision` and changed raw index fingerprint;
- untracked worktree state;
- config byte change while structural `revision` stays unchanged;
- active hook rejection;
- same hook name with changed hook bytes while structural `revision` stays unchanged;
- custom `core.hooksPath` rejection;
- `include`/`includeIf` fail-closed policy;
- existing structural confirmation accepting a worktree-only change while Phase-28 binding rejects it;
- exact canonical operation ordering changes operation digest and preview token;
- preview/confirmation/base/sandbox/result binding;
- fresh receipt assessment still reports `originalApplyAuthorized=false`;
- tampered operation order/result identity rejection;
- post-confirmation worktree, index, config, ref, HEAD and hook changes with specific reasons;
- two repositories with identical commit/ref structural revision are not substitutable because filesystem repository identity differs.

## 12. What Phase 28 did not add

No Phase-28 production surface provides:

- `apply_mutation` / `apply_to_original` Tauri command;
- renderer bridge method for original apply;
- generic argv/path/shell command;
- second transaction/controller/repository state path;
- automatic stash/reset/clean behavior;
- push/tag/publish/deploy behavior;
- release authority.

The existing one repository session, graph state, transaction controller and copy-preview backend remain authoritative.

## 13. Next coherent stage

The next unclaimed stage should remain **non-mutating** unless separately and explicitly authorized.

Recommended next stage:

> backend-owned authorization/idempotency + execution-isolation/atomicity design qualification on disposable fixtures only

That stage should prototype/qualify the capability ledger, final-preflight critical section, replay/crash recovery state machine, config/filter/program-execution isolation, and per-operation atomicity model **without registering or executing an original-repository apply command**.

Only after that evidence is complete should a separate instruction decide whether any narrowly scoped original-repository apply authority is acceptable.

## 14. Phase-29 authorization and replay qualification

Phase 29 adds a **non-executing backend model** in `mutation_authorization.rs`. It accepts no `RepositoryHandle`, filesystem path, Git command, shell/argv surface or Tauri state, so it cannot mutate either the selected repository or a fixture. Its purpose is to qualify authorization/replay semantics before any executor exists.

The authorization binding explicitly records:

```text
repository identity digest
  + strong source-state digest
  + Phase-28 receipt digest
  + transaction id
  + canonical operation digest
  + full preview-result digest
```

A backend-owned entropy seam supplies 32 bytes of capability secret material. Phase 29 deliberately provides **no default entropy implementation** and no renderer-facing constructor; a future production backend would have to supply a cryptographically secure source. The durable ledger record stores only a domain-separated SHA-256 digest of the secret. The raw capability secret is neither `Serialize` nor present in restart snapshots.

Capabilities are single-use. The ledger validates secret + exact binding, consumes the authorization, creates exactly one attempt identity, and only then runs the supplied final-preflight callback while holding the same ledger mutex. A correct capability is burned when binding or final freshness fails; it is never returned to an issued state.

This closes the **state-machine semantics** of single-use backend authorization, but it does not close the product boundary: no durable atomic production store is installed, no Tauri command can issue/consume a capability, and no repository effect follows successful consumption. `MutationPreflightAssessment.original_apply_authorized` therefore remains `false`, and the original Phase-28 unresolved-boundary list remains intentionally unchanged.

## 15. Durable attempt/restart model

`MutationAuthorizationLedgerSnapshot` is serializable evidence for a future durable store contract. Tests serialize/deserialize it across a simulated process restart. Recovery is fail-closed:

| Durable state at restart | Recovered state | Automatic retry |
| --- | --- | --- |
| authorization `issued` | `expired-on-restart` | never |
| attempt `reserved-before-effect` | `abandoned-before-effect` | never |
| attempt `effect-started` | `recovery-required` | never |
| terminal attempt | same terminal state | never |

The critical ordering requirement is:

```text
validate exact capability + binding
  -> consume authorization / reserve attempt
  -> final preflight under ledger critical section
  -> DURABLY record effect-started
  -> first effect may begin
  -> durable terminal outcome
```

A crash after the effect-start marker is intentionally treated as uncertain even if no individual effect step was recorded. A future recovery flow must inspect the repository and require explicit operator action; it must not replay the operation automatically.

Phase 29 does **not** claim that a serializable snapshot is itself a crash-safe production database. Atomic/fsync-qualified persistence, corruption handling, exclusive ownership and startup recovery are still required before `durable-idempotency-replay-ledger` can be removed from the production blocker list.

## 16. Final-preflight critical section and remaining TOCTOU

The Phase-29 mutex proves only backend ledger serialization: two consumers cannot spend one capability concurrently, and the final-preflight callback runs while capability consumption is serialized.

It does not lock out another Git process. The source snapshot still has to be captured through filesystem/repository reads, and an external process can mutate refs/index/worktree/config after that capture. There is still no repository handle/lock/ref-transaction primitive spanning final source observation through the first original effect.

Therefore `race-free-final-preflight-and-effect` remains a blocker for **every** operation class. Phase 29 does not reinterpret a successful ledger reservation as repository authority.

## 17. External-program/config isolation

The existing disposable-copy preview subprocess wrapper already narrows several influences: it supplies an empty `core.hooksPath`, disables commit/tag signing, suppresses global/system Git config, disables terminal prompting, and fixes committer identity. This is useful preview hardening, not an original-execution proof.

The current `Command` construction does not clear the complete inherited process environment, and repository-local config plus worktree attributes can still affect porcelain behavior. Rewrite operations that checkout/merge/cherry-pick/commit can be influenced by filters, merge drivers, editors or helper/program configuration unless a future executor proves those paths impossible or fully backend-owned.

`assess_mutation_execution_isolation` therefore models explicit fail-closed inputs for:

- inherited subprocess environment;
- unbound effective config;
- hooks/custom hook paths/includes;
- filters and merge drivers;
- signing programs;
- editors;
- credential/transport helpers;
- network access.

The only isolation profile that Phase 29 treats as closed in the abstract is a pure backend-owned, no-subprocess/no-external-program effect model. No such original-repository executor is installed.

## 18. Per-operation effect/atomicity decision

All ten previewable operation kinds remain **fail-closed** for original apply. Phase 29 distinguishes why rather than weakening the safety case:

| Operations | Effect class | Disposable/pure model | Production blockers |
| --- | --- | --- | --- |
| branch-create, branch-delete, tag-create, tag-delete, tag-move | single ref update | one expected-old/new state transition can be modeled atomically | final repository TOCTOU; no crash-safe durable ledger store; no qualified original ref-transaction executor |
| branch-rename | ref rename + config/reflog/possibly HEAD semantics | multi-plane transition identified, not claimed atomic | above plus multi-ref/config/reflog atomicity is unclosed |
| cherry-pick, rebase-reorder, squash, fixup | objects + ref + index/worktree rewrite | explicit multi-step/crash model only | final TOCTOU; durable store; index/worktree crash recovery; external-program isolation |

Unreachable object creation by itself may be tolerable in a future rewrite design, but the current preview semantics also move refs and use index/worktree porcelain. Phase 29 has no proof that those effects can be made atomically recoverable while preserving the exact previewed semantics, so the entire rewrite class remains closed.

## 19. Phase-29 authority boundary and next stage

Phase 29 adds no:

- original-repository executor or `RepositoryHandle` consumer in the authorization module;
- `apply_mutation` / `apply_to_original` Tauri command;
- renderer bridge method for original apply;
- enabled Apply control;
- arbitrary path/argv/shell authority;
- second transaction/controller/repository state route;
- automatic retry/recovery executor;
- push/tag/publish/deploy authority.

The next coherent stage remains non-mutating:

> **Phase 30 candidate: durable-ledger atomic-store + single-ref transaction/final-TOCTOU feasibility qualification on disposable fixtures only.**

That stage should qualify crash-safe atomic persistence/recovery of the Phase-29 ledger and test whether the five single-ref operation kinds can be implemented through a backend-owned expected-old ref transaction with a defensible final-lock boundary. Branch rename and all rewrite operations should remain fail-closed unless their additional multi-plane/crash/external-execution risks receive independent evidence. Even a green Phase 30 must not register original-repository apply authority without a separate explicit instruction.

## 20. Phase-30 durable ledger atomic-store qualification

Phase 30 adds `MutationAuthorizationAtomicStore`, a backend-owned persistence primitive for `MutationAuthorizationLedgerSnapshot`. It is intentionally **not** an original-repository executor: the store accepts only a storage-root path and authorization snapshots. It has no `RepositoryHandle`, ref name, Git operation, renderer/Tauri state, or shell/argv interface, and no product command invokes it.

The qualified persistence protocol on the current Unix/Linux fixture platform is:

```text
validate bounded snapshot
  -> serialize checksummed/versioned envelope with monotonic generation
  -> write same-directory scratch file
  -> flush scratch
  -> fsync scratch
  -> atomic rename over committed ledger
  -> fsync containing directory
  -> reopen committed ledger
  -> revalidate version + bounds + checksum + generation + exact payload
```

The fixed store metadata names are backend-owned. Existing metadata symlinks are rejected rather than followed. One process holds an exclusive OS advisory lock on the fixed store lock file, so two cooperating backend store owners cannot concurrently replace one ledger. That lock protects only the ledger file protocol; it does **not** exclude Git or other repository writers.

Durable bounds are explicit and fail closed before replacement:

| Bound | Maximum |
| --- | ---: |
| authorization records | 1024 |
| attempt records | 1024 |
| completed effect steps per attempt | 64 |
| identifier/digest field | 512 bytes |
| failure reason | 8192 bytes |
| effect-step evidence string | 2048 bytes |
| serialized ledger payload | 2 MiB |

Deterministic fault injection covers `after-write`, `after-flush`, `after-file-sync`, `after-rename`, `after-directory-sync`, and `after-reopen`. Any persistence error or injected fault makes that store instance unusable until it is dropped and reopened; the caller cannot continue by retrying the uncertain write in-place.

Observed recovery semantics are deliberately conservative:

- faults before rename reopen the previously committed generation;
- process-level reopen after rename observes the new generation, but a fault after rename and before directory fsync is still treated as power-loss durability-uncertain;
- checksum corruption is rejected;
- unsupported store schema versions are rejected;
- restart recovery still converts `issued` to `expired-on-restart`, `reserved-before-effect` to `abandoned-before-effect`, and `effect-started` to `recovery-required`;
- none of those recovery states is automatically retryable.

This closes the Phase-29 question “can the authorization snapshot be persisted through a bounded, atomically replaced, fsync/reopen-verified backend store on the qualified fixture platform?” It does **not** remove the product-level durable-ledger boundary because the store remains intentionally unwired to any original-repository authority or effect protocol.

## 21. Phase-30 single-ref expected-old transaction qualification

The five single-ref operation kinds were exercised only in repository-local disposable repositories using Git 2.55 `update-ref --stdin` transactions:

```text
start
  -> create/delete/update <target-ref> <new?> <expected-old?>
  -> prepare
  -> commit
```

The fixture results are consistent across `branch-create`, `branch-delete`, `tag-create`, `tag-delete`, and `tag-move`:

- a stale expected-old state is rejected before the requested transition is committed;
- after `prepare`, a competing writer to the **same target ref** cannot acquire the ref lock;
- a successful commit publishes exactly the requested single-ref transition;
- killing the prepared `git update-ref` process before commit publishes no target-ref transition.

The crash case exposed an additional fail-closed recovery requirement: a SIGKILL after `prepare` can leave the target `<ref>.lock` file behind. Subsequent writers fail with `cannot lock ref` until that stale lock is explicitly reconciled. The Phase-30 test removes the lock only inside its disposable fixture to prove the diagnosis; there is no production stale-lock cleanup path and no automatic replay. A future executor must distinguish a stale lock from a live concurrent owner and recover it explicitly before any new attempt can be considered.

These tests qualify Git's target-ref expected-old/locking behavior as a useful primitive. They do **not** create `OriginalRefTransactionExecutor` production authority: the Git subprocess harness exists only in the integration test and is not exported from `gitinspect-core`, registered in Tauri, or reachable from the selected repository route.

## 22. Final TOCTOU feasibility result: target-ref locking is insufficient

Phase 30 explicitly tested the strongest ordering available from the Phase-28/29 model plus the new store and Git ref transaction:

```text
strong final preflight capture
  -> authorization is already consumed / attempt reserved
  -> durably persist reserved-before-effect
  -> durably persist effect-started
  -> git update-ref start + prepare target ref
  -> durably record target-ref-prepared effect step
  -> competing Git writer changes a different ref
  -> target expected-old transaction commits successfully
```

The competing writer to a different ref succeeds while the target transaction is prepared. A subsequent strong preflight has a different `state_digest` and different ref set, yet the original target expected-old condition still holds and the target transaction can commit.

Therefore the Phase-28 exact source binding can become stale after final capture even when all of the following are true at once:

- capability consumption is serialized;
- attempt reservation is durably committed;
- `effect-started` is durably committed before the first ref-lock filesystem effect;
- the target ref is protected by Git's expected-old transaction and prepared ref lock.

The reason is structural: a target-ref lock excludes only writers contending for that target, while the Phase-28 receipt binds the whole repository/source state, including all exact refs plus index/worktree/config/hook evidence. The durable ledger has no repository exclusion semantics and cannot repair that gap.

`FinalRepositoryToctou` therefore remains an authoritative blocker for **all ten** mutation operation kinds. Phase 30 must not narrow that blocker merely because same-target races are closed.

## 23. Phase-30 authority decision and operation matrix

The original-repository decision remains **NO-GO**. `MutationPreflightAssessment.original_apply_authorized` remains `false`; no Phase-30 code changes that contract.

The operation matrix after Phase 30 is:

| Operations | Newly qualified primitive | Remaining original-apply blockers |
| --- | --- | --- |
| branch-create, branch-delete, tag-create, tag-delete, tag-move | bounded durable ledger storage; fixture-only target-ref expected-old transaction; same-target race exclusion | whole-source final TOCTOU; store not wired to original authority; no qualified original ref executor; crash-left stale ref-lock reconciliation |
| branch-rename | durable ledger primitive only | all above plus multi-ref/config/reflog/HEAD atomicity |
| cherry-pick, rebase-reorder, squash, fixup | durable ledger primitive only | whole-source final TOCTOU; store not wired to original authority; index/worktree crash recovery; repository-controlled/external program isolation; rewrite-specific effect reconciliation |

Phase 30 adds no:

- original-repository apply executor or command;
- Tauri original-apply command;
- renderer issuance/consumption route;
- enabled Apply control;
- generic path/argv/shell authority;
- second repository/graph/controller/backend mutation route;
- automatic retry after an uncertain effect;
- production stale-ref-lock deletion/recovery;
- branch-rename or rewrite qualification;
- push/tag/publish/deploy authority.

The existing disposable-copy preview route remains the only mutation execution route.

## 24. Next coherent stage after Phase 30

The next unclaimed stage should remain **disposable-only and non-authorizing**:

> **whole-source concurrency-envelope + crash/ref-lock outcome-reconciliation feasibility qualification for the five single-ref kinds**

That stage should determine whether any backend-owned mechanism can actually preserve the Phase-28 whole-source predicate from final capture through target commit against **external Git processes**, rather than merely serializing Gitinspect itself. It should also qualify restart inspection of `effect-started` attempts and stale ref locks so the backend can distinguish `not committed`, `committed as expected`, `diverged`, and `lock recovery required` without automatic retry.

If no repository-wide exclusion mechanism honored by independent Git writers can be demonstrated, the safety case must retain the TOCTOU blocker rather than weakening the Phase-28 source binding. Branch rename and all rewrite operations remain outside that next stage unless separately authorized and independently qualified.

## 25. Phase-31 whole-source concurrency-envelope qualification

Phase 31 keeps the exact Phase-28 source predicate unchanged and asks whether a lock/envelope can preserve it from the final capture through a five-kind single-ref target commit against writers outside Gitinspect.

The fixture evidence distinguishes two different mechanisms:

1. a backend-owned OS advisory lock can serialize cooperating Gitinspect processes, but an independent `git update-ref` process does not participate in that lock and can still create/update a ref;
2. a prepared Git 2.55 `update-ref --stdin` transaction can be strengthened beyond Phase 30 by including the target operation plus `verify` entries for every direct ref present in the final preflight.

The strengthened Git transaction does provide real exclusion for the finite set it names. A competing move of an existing locked ref fails with `cannot lock ref`. On the tested attached-HEAD fixture, a normal `git symbolic-ref HEAD ...` move is also rejected while the referent is in the prepared transaction because Git has established the relevant `HEAD` lock.

That is still not a whole-source concurrency envelope. While the same prepared transaction remains open, the qualification fixture demonstrates all of the following:

| Phase-28 source plane | Independent-writer result while target + all current direct refs are prepared |
| --- | --- |
| existing unrelated ref already in captured ref set | blocked by Git ref lock |
| normal symbolic HEAD movement | blocked by Git while its referent participates |
| **new ref name not present at final capture** | **succeeds**; the ref namespace is open-ended |
| index | **succeeds** via `git add` |
| tracked worktree bytes | **succeeds** independently of the ref transaction |
| local repository config | **succeeds** via `git config` |
| repository hook bytes | **succeeds** via an independent filesystem writer; hook bytes are not a ref-transaction participant |

After those successful source changes, a fresh `MutationPreflightSnapshot` has a different exact `state_digest`, ref set, index fingerprint/cleanliness, worktree cleanliness, config fingerprint and hook fingerprint. The originally prepared target transaction can nevertheless commit because every direct ref that it actually verified still satisfies its expected value.

This is stronger negative evidence than the Phase-30 target-only experiment: even locking **all refs that existed at final capture** does not reserve the future ref namespace and does not serialize the index/worktree/config/hook state bound by Phase 28. A cooperative Gitinspect lock is likewise not external-Git exclusion.

Phase 31 therefore demonstrates **no external-writer-honored whole-source envelope for this execution architecture**. This is a qualification result, not a claim that no filesystem or repository architecture could ever provide stronger exclusion. For the current design, however, `FinalRepositoryToctou` remains a terminal blocker and the safety case must not narrow the Phase-28 receipt to make the ref primitive pass.

## 26. Phase-31 crash/ref-lock outcome reconciliation

Phase 31 separately qualifies a read-only restart-inspection model for the five single-ref kinds only:

- `branch-create`;
- `branch-delete`;
- `tag-create`;
- `tag-delete`;
- `tag-move`.

Every reconciliation scenario begins from a `MutationAuthorizationLedgerSnapshot` whose attempt is durably persisted as `effect-started` and read back from the committed Phase-30 store envelope. Phase 30 already independently qualifies process-level store reopen/recovery. Phase 31 composes that durable-store result with the existing Phase-29 restart model, which maps the persisted attempt to `recovery-required` and keeps `automatically_retryable=false` before repository outcome inspection begins.

The repository inspection itself reads only the target ref and target lock-file presence. Phase 31 now keeps **observed target relation** separate from **causal attempt outcome**. That distinction is necessary because Phase 31 also proves that independent writers are not excluded by a repository-wide envelope.

Its qualified fail-closed matrix is:

| Observed target relation | Target lock | Ownership evidence | Safe outcome | Automatic retry |
| --- | --- | --- | --- | --- |
| exact expected-old | absent | no external-writer provenance | `indeterminate` | never |
| exact expected-new | absent | no external-writer provenance | `indeterminate` | never |
| any third value | absent | n/a | `diverged` | never |
| any target value | present | fixture owner is proven dead | `lock-recovery-required` | never |
| any target value | present | owner is live or ownership/liveness is unknown | `indeterminate` | never |

The old/new observations are deliberately **not** called `not-committed` or `committed-as-expected`. Current ref value alone cannot establish that causal history once independent same-target writers are admitted. Phase-31 fixtures demonstrate two indistinguishable counter-histories across all five operation kinds:

1. the uncertain Gitinspect attempt commits expected-new, releases its target lock, and an independent writer restores expected-old before restart inspection;
2. the uncertain Gitinspect attempt never commits, but an independent writer produces exactly expected-new before restart inspection.

Those histories lead to the same expected-old/expected-new observations that the earlier candidate treated as causal proof. Without an external-writer-honored target-history envelope or another trustworthy provenance mechanism, both observations therefore remain `indeterminate`. A third value is safely classified as `diverged` because the target is currently at neither intended endpoint, without claiming who produced that value.

The stale-lock and live/unknown-lock cases remain qualified across all five kinds using a prepared Git transaction:

- SIGKILL leaves the target transition unpublished and the known stale lock present; the diagnosis is `lock-recovery-required`;
- while the prepared Git process is still alive, the same lock-file presence is `indeterminate`, because lock-file presence alone is not proof that deletion is safe.

The test harness removes known stale locks **only after recording the fixture diagnosis** so it can tear down disposable repositories. No production path deletes a stale ref lock, no production path infers owner death from the lock file, and no outcome initiates an automatic retry.

This qualifies a conservative restart inspection that distinguishes expected-old, expected-new, third-value, known-stale-lock and live/unknown-lock observations without replay. It does **not** qualify causal `not-committed` / `committed-as-expected` attribution from current ref state alone, and it does not install a production recovery service, original ref executor, ownership oracle, provenance oracle, or lock-deletion authority.

## 27. Phase-31 authority decision

The original-repository decision remains **NO-GO**.

The Phase-31 gate results are:

```text
external-writer-honored whole-source concurrency envelope: NOT DEMONSTRATED
fail-closed crash/ref-lock read-only reconciliation:          DEMONSTRATED on disposable fixtures
causal old/new commit attribution from current ref alone:     NOT DEMONSTRATED
```

The reconciliation result is intentionally fail-closed: it can distinguish the requested observable states, but expected-old and expected-new remain `indeterminate` when external same-target history is unproven. Because the authority gate requires an external-writer-honored whole-source envelope as well as explicit crash/ref-lock reconciliation, Phase 31 cannot remove the Phase-30 execution blocker. `MutationPreflightAssessment.original_apply_authorized=false` remains authoritative and `FinalRepositoryToctou` remains present for every mutation kind.

For the five single-ref operations, the evidence supports a precise statement: expected-old target transitions, prepared-lock diagnosis and current target-state classification are useful qualified primitives, but they do not prove an uncertain attempt's causal commit history, lack a whole-source final freshness envelope, and remain unwired to any original-repository executor.

Phase 31 adds no:

- selected/original repository apply executor;
- original-apply Tauri command;
- renderer capability issuance or consumption;
- enabled Apply control;
- generic path/argv/shell authority;
- automatic retry;
- production stale-lock deletion;
- branch-rename qualification;
- rewrite qualification;
- push/tag/publish/deploy authority.

`branch-rename` remains blocked on multi-ref/config/reflog/HEAD atomicity. `cherry-pick`, `rebase-reorder`, `squash`, and `fixup` remain blocked on index/worktree crash recovery and repository-controlled/external-program execution risks. The disposable-copy preview route remains the only mutation execution route.

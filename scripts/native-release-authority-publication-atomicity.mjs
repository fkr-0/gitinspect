#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const PASS = "NATIVE_RELEASE_AUTHORITY_PUBLICATION_ATOMICITY=PASS";
const SCHEMA_VERSION = 1;
const MANIFEST_NAME = "native-release-authority.json";
const PAYLOAD_NAMES = Object.freeze({
  summary: "summary.json",
  gate: "native-release-qualification.sh",
  sourceEvidence: "source-evidence.json",
  candidate: "candidate.json",
});

class PublicationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "PublicationError";
    this.code = code;
  }
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assert(condition, code, message = code) {
  if (!condition) {
    throw new PublicationError(code, message);
  }
}

function parseJsonBytes(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new PublicationError(code, `${code}: ${error.message}`);
  }
}

function expectedPayloadPath(generation, kind) {
  return `generations/${generation}/${PAYLOAD_NAMES[kind]}`;
}

function validateRelativePath(relative, expected, label) {
  assert(typeof relative === "string" && relative.length > 0, "PATH_SUBSTITUTION", `${label} missing`);
  assert(!path.posix.isAbsolute(relative), "PATH_SUBSTITUTION", `${label} must be relative`);
  assert(path.posix.normalize(relative) === relative, "PATH_SUBSTITUTION", `${label} must be normalized`);
  assert(!relative.startsWith("../") && relative !== "..", "PATH_SUBSTITUTION", `${label} escaped fixture`);
  assert(relative === expected, "PATH_SUBSTITUTION", `${label} substituted: ${relative}`);
}

function fixtureFile(fixtureRoot, relative) {
  const resolved = path.resolve(fixtureRoot, relative);
  const prefix = `${path.resolve(fixtureRoot)}${path.sep}`;
  assert(resolved.startsWith(prefix), "PATH_SUBSTITUTION", `path escaped fixture: ${relative}`);
  const stat = fs.lstatSync(resolved);
  assert(stat.isFile() && !stat.isSymbolicLink(), "PATH_SUBSTITUTION", `path is not a regular file: ${relative}`);
  return resolved;
}

function validateManifestBytes(fixtureRoot, manifestBytes) {
  const manifest = parseJsonBytes(manifestBytes, "MANIFEST_MALFORMED");
  assert(manifest.schemaVersion === SCHEMA_VERSION, "MANIFEST_MALFORMED", "unexpected schema version");
  assert(typeof manifest.generation === "string" && /^[a-z0-9-]+$/.test(manifest.generation), "MANIFEST_MALFORMED", "invalid generation");
  assert(typeof manifest.nativeHead === "string" && /^[0-9a-f]{40}$/.test(manifest.nativeHead), "MANIFEST_MALFORMED", "invalid native head");

  for (const kind of Object.keys(PAYLOAD_NAMES)) {
    validateRelativePath(manifest[`${kind}Path`], expectedPayloadPath(manifest.generation, kind), `${kind}Path`);
    assert(/^[0-9a-f]{64}$/.test(manifest[`${kind}Sha256`] ?? ""), "MANIFEST_MALFORMED", `invalid ${kind} sha256`);
  }

  const payload = {};
  for (const kind of Object.keys(PAYLOAD_NAMES)) {
    const file = fixtureFile(fixtureRoot, manifest[`${kind}Path`]);
    const bytes = fs.readFileSync(file);
    assert(sha256Bytes(bytes) === manifest[`${kind}Sha256`], "PAYLOAD_HASH_MISMATCH", `${kind} bytes are stale`);
    payload[kind] = { file, bytes };
  }

  const summary = parseJsonBytes(payload.summary.bytes, "SUMMARY_MALFORMED");
  const sourceEvidence = parseJsonBytes(payload.sourceEvidence.bytes, "SOURCE_EVIDENCE_MALFORMED");
  const candidate = parseJsonBytes(payload.candidate.bytes, "CANDIDATE_MALFORMED");

  assert(summary.schemaVersion === 1 && summary.status === "PASS", "SUMMARY_SEMANTICS_MISMATCH");
  assert(summary.generation === manifest.generation && summary.head === manifest.nativeHead, "SUMMARY_SEMANTICS_MISMATCH");
  assert(summary.gatePath === manifest.gatePath && summary.gateSha256 === manifest.gateSha256, "SUMMARY_SEMANTICS_MISMATCH");
  assert(
    summary.sourceEvidencePath === manifest.sourceEvidencePath && summary.sourceEvidenceSha256 === manifest.sourceEvidenceSha256,
    "SUMMARY_SEMANTICS_MISMATCH",
  );

  assert(sourceEvidence.schemaVersion === 1, "SOURCE_EVIDENCE_SEMANTICS_MISMATCH");
  assert(sourceEvidence.generation === manifest.generation && sourceEvidence.head === manifest.nativeHead, "SOURCE_EVIDENCE_SEMANTICS_MISMATCH");
  assert(sourceEvidence.gateSha256 === manifest.gateSha256, "SOURCE_EVIDENCE_SEMANTICS_MISMATCH");

  assert(candidate.schemaVersion === 1 && candidate.status === "READY", "CANDIDATE_SEMANTICS_MISMATCH");
  assert(candidate.generation === manifest.generation && candidate.head === manifest.nativeHead, "CANDIDATE_SEMANTICS_MISMATCH");
  assert(candidate.summarySha256 === manifest.summarySha256, "CANDIDATE_SEMANTICS_MISMATCH");
  assert(candidate.gateSha256 === manifest.gateSha256, "CANDIDATE_SEMANTICS_MISMATCH");
  assert(candidate.sourceEvidenceSha256 === manifest.sourceEvidenceSha256, "CANDIDATE_SEMANTICS_MISMATCH");

  return { manifest, payload };
}

function readCanonicalAuthority(fixtureRoot, canonicalManifest) {
  const before = fs.readFileSync(canonicalManifest);
  const validated = validateManifestBytes(fixtureRoot, before);
  const after = fs.readFileSync(canonicalManifest);
  assert(before.equals(after), "MANIFEST_CHANGED_DURING_READ");
  return { ...validated, manifestBytes: before };
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function durableWriteNew(file, bytes) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function buildGeneration(fixtureRoot, generation, nativeHead) {
  const generationDir = path.join(fixtureRoot, "generations", generation);
  fs.mkdirSync(generationDir, { recursive: true, mode: 0o700 });

  const gatePath = expectedPayloadPath(generation, "gate");
  const gateBytes = Buffer.from(`#!/usr/bin/env bash\n# fixture generation ${generation}; never production\nexit 0\n`, "utf8");
  durableWriteNew(path.join(fixtureRoot, gatePath), gateBytes);
  const gateSha256 = sha256Bytes(gateBytes);

  const sourceEvidencePath = expectedPayloadPath(generation, "sourceEvidence");
  const sourceEvidenceBytes = canonicalJson({
    schemaVersion: 1,
    generation,
    head: nativeHead,
    gateSha256,
    sourceDigest: sha256Bytes(Buffer.from(`source:${generation}:${nativeHead}`, "utf8")),
  });
  durableWriteNew(path.join(fixtureRoot, sourceEvidencePath), sourceEvidenceBytes);
  const sourceEvidenceSha256 = sha256Bytes(sourceEvidenceBytes);

  const summaryPath = expectedPayloadPath(generation, "summary");
  const summaryBytes = canonicalJson({
    schemaVersion: 1,
    status: "PASS",
    generation,
    head: nativeHead,
    gatePath,
    gateSha256,
    sourceEvidencePath,
    sourceEvidenceSha256,
    contract: {
      canonicalManifestPublication: "single-rename",
      immutableGenerationPayloads: true,
      simulatedOnly: true,
    },
  });
  durableWriteNew(path.join(fixtureRoot, summaryPath), summaryBytes);
  const summarySha256 = sha256Bytes(summaryBytes);

  const candidatePath = expectedPayloadPath(generation, "candidate");
  const candidateBytes = canonicalJson({
    schemaVersion: 1,
    status: "READY",
    generation,
    head: nativeHead,
    summarySha256,
    gateSha256,
    sourceEvidenceSha256,
  });
  durableWriteNew(path.join(fixtureRoot, candidatePath), candidateBytes);
  const candidateSha256 = sha256Bytes(candidateBytes);

  fsyncDirectory(generationDir);
  fsyncDirectory(path.dirname(generationDir));

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generation,
    summaryPath,
    summarySha256,
    nativeHead,
    gatePath,
    gateSha256,
    sourceEvidencePath,
    sourceEvidenceSha256,
    candidatePath,
    candidateSha256,
  };
  return { manifest, manifestBytes: canonicalJson(manifest) };
}

function replaceManifestFixtureOnly(canonicalManifest, manifestBytes) {
  const directory = path.dirname(canonicalManifest);
  const temp = path.join(directory, `.${MANIFEST_NAME}.fixture-replace-${process.pid}-${crypto.randomUUID()}`);
  durableWriteNew(temp, manifestBytes);
  fs.renameSync(temp, canonicalManifest);
  fsyncDirectory(directory);
}

function publishPreparedAuthority({
  fixtureRoot,
  canonicalManifest,
  expectedManifestBytes,
  expectedSummarySha256,
  expectedGateSha256,
  proposedManifestBytes,
  beforeRename = undefined,
  rename = fs.renameSync,
}) {
  const directory = path.dirname(canonicalManifest);
  const publicationLock = `${canonicalManifest}.publication-lock`;
  try {
    fs.mkdirSync(publicationLock, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") throw new PublicationError("CONCURRENT_PUBLISHER");
    throw error;
  }

  try {
    const currentBytes = fs.readFileSync(canonicalManifest);
    assert(currentBytes.equals(expectedManifestBytes), "STALE_EXPECTED_MANIFEST_BYTES");
    const current = validateManifestBytes(fixtureRoot, currentBytes).manifest;
    assert(current.summarySha256 === expectedSummarySha256, "STALE_EXPECTED_SUMMARY_SHA");
    assert(current.gateSha256 === expectedGateSha256, "STALE_EXPECTED_GATE_SHA");

    // All future authority bytes are complete and coherent before the canonical
    // manifest is staged. Generation payloads are immutable after this check.
    validateManifestBytes(fixtureRoot, proposedManifestBytes);

    const temp = path.join(directory, `.${MANIFEST_NAME}.publish-${process.pid}-${crypto.randomUUID()}`);
    let tempExists = false;
    try {
      durableWriteNew(temp, proposedManifestBytes);
      tempExists = true;
      beforeRename?.({ temp });

      // All compliant publishers share publicationLock. The exact byte compare
      // immediately before rename additionally rejects an out-of-band authority
      // change observed after preparation but before the commit point.
      const preRenameBytes = fs.readFileSync(canonicalManifest);
      assert(preRenameBytes.equals(expectedManifestBytes), "CONCURRENT_AUTHORITY_CHANGE");

      try {
        rename(temp, canonicalManifest);
        tempExists = false;
      } catch (error) {
        throw new PublicationError("RENAME_FAILED", `RENAME_FAILED: ${error.code ?? error.message}`);
      }
      fsyncDirectory(directory);
    } finally {
      if (tempExists) fs.rmSync(temp, { force: true });
    }

    const published = readCanonicalAuthority(fixtureRoot, canonicalManifest);
    assert(published.manifestBytes.equals(proposedManifestBytes), "PUBLISHED_BYTES_MISMATCH");
    return published;
  } finally {
    fs.rmdirSync(publicationLock);
  }
}

function expectPublicationError(code, fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof PublicationError && error.code === code) return;
    throw error;
  }
  throw new PublicationError("SELF_TEST_FAILURE", `expected ${code}`);
}

async function runConcurrentReaders(fixtureRoot, canonicalManifest, generations) {
  const workerCount = 4;
  const iterations = 1500;
  const workers = [];
  let ready = 0;

  const readyPromise = new Promise((resolve, reject) => {
    for (let index = 0; index < workerCount; index += 1) {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { mode: "reader", fixtureRoot, canonicalManifest, iterations },
      });
      const exitPromise = new Promise((exitResolve, exitReject) => {
        worker.once("error", exitReject);
        worker.once("exit", (code) => (code === 0 ? exitResolve() : exitReject(new Error(`reader worker exited ${code}`))));
      });
      const state = { worker, result: null, exitPromise };
      workers.push(state);
      worker.on("message", (message) => {
        if (message.type === "ready") {
          ready += 1;
          if (ready === workerCount) resolve();
        } else if (message.type === "result") {
          state.result = message;
        }
      });
      worker.on("error", reject);
    }
  });

  await readyPromise;
  for (const { worker } of workers) worker.postMessage({ type: "start" });

  let current = readCanonicalAuthority(fixtureRoot, canonicalManifest);
  for (let round = 0; round < 80; round += 1) {
    const next = generations[round % generations.length];
    current = publishPreparedAuthority({
      fixtureRoot,
      canonicalManifest,
      expectedManifestBytes: current.manifestBytes,
      expectedSummarySha256: current.manifest.summarySha256,
      expectedGateSha256: current.manifest.gateSha256,
      proposedManifestBytes: next.manifestBytes,
    });
    // Keep writer and readers overlapped instead of completing all renames in
    // one event-loop turn.
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  await Promise.all(workers.map(({ exitPromise }) => exitPromise));

  let accepted = 0;
  let changedDuringRead = 0;
  for (const state of workers) {
    assert(state.result?.type === "result", "SELF_TEST_FAILURE", "reader worker returned no result");
    assert(state.result.unexpected.length === 0, "SELF_TEST_FAILURE", `unexpected reader errors: ${state.result.unexpected.join(",")}`);
    accepted += state.result.accepted;
    changedDuringRead += state.result.changedDuringRead;
  }
  assert(accepted > 0, "SELF_TEST_FAILURE", "concurrent readers accepted no coherent state");
  return { workerCount, iterations, accepted, changedDuringRead };
}

function runReaderWorker() {
  parentPort.postMessage({ type: "ready" });
  parentPort.once("message", (message) => {
    if (message.type !== "start") process.exit(2);
    let accepted = 0;
    let changedDuringRead = 0;
    const unexpected = [];
    for (let index = 0; index < workerData.iterations; index += 1) {
      try {
        readCanonicalAuthority(workerData.fixtureRoot, workerData.canonicalManifest);
        accepted += 1;
      } catch (error) {
        if (error instanceof PublicationError && error.code === "MANIFEST_CHANGED_DURING_READ") {
          changedDuringRead += 1;
        } else {
          unexpected.push(error.code ?? error.message);
          break;
        }
      }
    }
    parentPort.postMessage({ type: "result", accepted, changedDuringRead, unexpected });
  });
}

async function main() {
  const repoRoot = process.cwd();
  const gitDir = path.join(repoRoot, ".git");
  assert(fs.statSync(gitDir).isDirectory(), "SELF_TEST_FAILURE", "run from repository root");

  const productionFiles = [
    "scripts/native-release-authority.json",
    "scripts/native-release-qualification.sh",
    ".ws-bridge/evidence/gitinspect-phase46-native-qualification.json",
  ];
  const productionBefore = new Map(productionFiles.map((relative) => [relative, sha256File(path.join(repoRoot, relative))]));

  const runtimeRoot = path.join(gitDir, "native-release-authority-publication-atomicity");
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  const fixtureRoot = fs.mkdtempSync(path.join(runtimeRoot, "phase49-"));
  const canonicalDir = path.join(fixtureRoot, "scripts");
  const canonicalManifest = path.join(canonicalDir, MANIFEST_NAME);
  fs.mkdirSync(canonicalDir, { recursive: true, mode: 0o700 });

  try {
    const oldGeneration = buildGeneration(fixtureRoot, "old", "1".repeat(40));
    const newGeneration = buildGeneration(fixtureRoot, "new", "2".repeat(40));
    const rivalGeneration = buildGeneration(fixtureRoot, "rival", "3".repeat(40));
    durableWriteNew(canonicalManifest, oldGeneration.manifestBytes);
    fsyncDirectory(canonicalDir);

    const baseline = readCanonicalAuthority(fixtureRoot, canonicalManifest);
    assert(baseline.manifest.generation === "old", "SELF_TEST_FAILURE");

    expectPublicationError("STALE_EXPECTED_MANIFEST_BYTES", () =>
      publishPreparedAuthority({
        fixtureRoot,
        canonicalManifest,
        expectedManifestBytes: Buffer.from("stale manifest bytes\n"),
        expectedSummarySha256: baseline.manifest.summarySha256,
        expectedGateSha256: baseline.manifest.gateSha256,
        proposedManifestBytes: newGeneration.manifestBytes,
      }),
    );

    expectPublicationError("STALE_EXPECTED_SUMMARY_SHA", () =>
      publishPreparedAuthority({
        fixtureRoot,
        canonicalManifest,
        expectedManifestBytes: baseline.manifestBytes,
        expectedSummarySha256: "a".repeat(64),
        expectedGateSha256: baseline.manifest.gateSha256,
        proposedManifestBytes: newGeneration.manifestBytes,
      }),
    );

    expectPublicationError("STALE_EXPECTED_GATE_SHA", () =>
      publishPreparedAuthority({
        fixtureRoot,
        canonicalManifest,
        expectedManifestBytes: baseline.manifestBytes,
        expectedSummarySha256: baseline.manifest.summarySha256,
        expectedGateSha256: "b".repeat(64),
        proposedManifestBytes: newGeneration.manifestBytes,
      }),
    );

    const staleProposedSummary = canonicalJson({ ...newGeneration.manifest, summarySha256: "c".repeat(64) });
    expectPublicationError("PAYLOAD_HASH_MISMATCH", () =>
      publishPreparedAuthority({
        fixtureRoot,
        canonicalManifest,
        expectedManifestBytes: baseline.manifestBytes,
        expectedSummarySha256: baseline.manifest.summarySha256,
        expectedGateSha256: baseline.manifest.gateSha256,
        proposedManifestBytes: staleProposedSummary,
      }),
    );
    const staleProposedGate = canonicalJson({ ...newGeneration.manifest, gateSha256: "d".repeat(64) });
    expectPublicationError("PAYLOAD_HASH_MISMATCH", () =>
      publishPreparedAuthority({
        fixtureRoot,
        canonicalManifest,
        expectedManifestBytes: baseline.manifestBytes,
        expectedSummarySha256: baseline.manifest.summarySha256,
        expectedGateSha256: baseline.manifest.gateSha256,
        proposedManifestBytes: staleProposedGate,
      }),
    );

    const publicationLock = `${canonicalManifest}.publication-lock`;
    fs.mkdirSync(publicationLock, { mode: 0o700 });
    try {
      expectPublicationError("CONCURRENT_PUBLISHER", () =>
        publishPreparedAuthority({
          fixtureRoot,
          canonicalManifest,
          expectedManifestBytes: baseline.manifestBytes,
          expectedSummarySha256: baseline.manifest.summarySha256,
          expectedGateSha256: baseline.manifest.gateSha256,
          proposedManifestBytes: newGeneration.manifestBytes,
        }),
      );
    } finally {
      fs.rmdirSync(publicationLock);
    }

    const substitutedSummary = path.join(fixtureRoot, "generations", "new", "summary-copy.json");
    fs.copyFileSync(path.join(fixtureRoot, newGeneration.manifest.summaryPath), substitutedSummary, fs.constants.COPYFILE_EXCL);
    const substitutedManifest = {
      ...newGeneration.manifest,
      summaryPath: "generations/new/summary-copy.json",
    };
    expectPublicationError("PATH_SUBSTITUTION", () =>
      publishPreparedAuthority({
        fixtureRoot,
        canonicalManifest,
        expectedManifestBytes: baseline.manifestBytes,
        expectedSummarySha256: baseline.manifest.summarySha256,
        expectedGateSha256: baseline.manifest.gateSha256,
        proposedManifestBytes: canonicalJson(substitutedManifest),
      }),
    );

    const interruptedTemp = path.join(canonicalDir, `.${MANIFEST_NAME}.interrupted`);
    fs.writeFileSync(interruptedTemp, newGeneration.manifestBytes.subarray(0, Math.floor(newGeneration.manifestBytes.length / 2)), { flag: "wx" });
    const afterInterruptedTemp = readCanonicalAuthority(fixtureRoot, canonicalManifest);
    assert(afterInterruptedTemp.manifest.generation === "old", "SELF_TEST_FAILURE", "interrupted temp acquired authority");
    fs.unlinkSync(interruptedTemp);

    expectPublicationError("RENAME_FAILED", () =>
      publishPreparedAuthority({
        fixtureRoot,
        canonicalManifest,
        expectedManifestBytes: baseline.manifestBytes,
        expectedSummarySha256: baseline.manifest.summarySha256,
        expectedGateSha256: baseline.manifest.gateSha256,
        proposedManifestBytes: newGeneration.manifestBytes,
        rename: () => {
          const error = new Error("injected rename failure");
          error.code = "EIO";
          throw error;
        },
      }),
    );
    assert(readCanonicalAuthority(fixtureRoot, canonicalManifest).manifest.generation === "old", "SELF_TEST_FAILURE", "rename failure changed canonical state");

    expectPublicationError("CONCURRENT_AUTHORITY_CHANGE", () =>
      publishPreparedAuthority({
        fixtureRoot,
        canonicalManifest,
        expectedManifestBytes: baseline.manifestBytes,
        expectedSummarySha256: baseline.manifest.summarySha256,
        expectedGateSha256: baseline.manifest.gateSha256,
        proposedManifestBytes: newGeneration.manifestBytes,
        beforeRename: () => replaceManifestFixtureOnly(canonicalManifest, rivalGeneration.manifestBytes),
      }),
    );
    assert(readCanonicalAuthority(fixtureRoot, canonicalManifest).manifest.generation === "rival", "SELF_TEST_FAILURE", "concurrent state was overwritten");

    replaceManifestFixtureOnly(canonicalManifest, oldGeneration.manifestBytes);
    const concurrent = await runConcurrentReaders(fixtureRoot, canonicalManifest, [newGeneration, oldGeneration]);

    console.log("authority_publication_fixture=PASS repository_local=true immutable_generation_payloads=true canonical_manifest_single_rename=true simulated_only=true");
    console.log(
      "publication_failure_matrix=PASS stale_expected_manifest_bytes=true stale_expected_summary_hash=true stale_expected_gate_hash=true stale_proposed_summary_hash=true stale_proposed_gate_hash=true path_substitution=true interrupted_temp_ignored=true rename_failure_fail_closed=true concurrent_publisher_blocked=true concurrent_authority_change_fail_closed=true",
    );
    console.log(
      `concurrent_reader_loops=PASS workers=${concurrent.workerCount} iterations_per_worker=${concurrent.iterations} accepted_coherent=${concurrent.accepted} rejected_manifest_changed=${concurrent.changedDuringRead} mixed_authority_accepted=false`,
    );

    for (const [relative, beforeSha] of productionBefore) {
      assert(sha256File(path.join(repoRoot, relative)) === beforeSha, "SELF_TEST_FAILURE", `production byte changed: ${relative}`);
    }
    console.log("production_authority_bytes=UNCHANGED manifest=true native_gate=true inherited_phase46_summary=true");
    console.log(PASS);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    if (fs.existsSync(runtimeRoot) && fs.readdirSync(runtimeRoot).length === 0) fs.rmdirSync(runtimeRoot);
  }
}

if (!isMainThread) {
  if (workerData?.mode !== "reader") process.exit(2);
  runReaderWorker();
} else {
  main().catch((error) => {
    const code = error instanceof PublicationError ? error.code : error.name;
    console.error(`NATIVE_RELEASE_AUTHORITY_PUBLICATION_ATOMICITY=FAIL reason=${code} detail=${JSON.stringify(error.message)}`);
    process.exitCode = 1;
  });
}

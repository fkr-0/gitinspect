import type { GitRepositorySnapshot } from "@gitinspect/contracts";

const REVISION_DOMAIN = "gitinspect-snapshot-v1\0";

type RepositoryRevisionMetadata = Pick<
  GitRepositorySnapshot,
  "head" | "headRef" | "refs" | "remotes" | "hooks"
>;

function appendField(parts: string[], value: string | undefined): void {
  if (value !== undefined) parts.push(value);
  parts.push("\0");
}

/**
 * Browser-side implementation of the versioned structural revision contract in
 * crates/gitinspect-core/src/repository.rs. Keep the domain separator and field
 * order in lockstep with Rust; the fixed-vector test makes drift fail loudly.
 */
export async function computeRepositoryRevision(
  metadata: RepositoryRevisionMetadata,
): Promise<string> {
  const parts = [REVISION_DOMAIN];
  appendField(parts, metadata.head);
  appendField(parts, metadata.headRef);
  for (const reference of metadata.refs) {
    appendField(parts, reference.name);
    appendField(parts, reference.targetOid);
    appendField(parts, reference.symbolicTarget);
    appendField(parts, reference.upstream);
  }
  for (const remote of metadata.remotes) {
    appendField(parts, remote.name);
    for (const url of remote.fetchUrls) appendField(parts, url);
    for (const url of remote.pushUrls) appendField(parts, url);
  }
  for (const hook of metadata.hooks) appendField(parts, hook);

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable for repository revision verification");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(parts.join("")));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex}`;
}

export async function verifyRepositoryRevision(snapshot: GitRepositorySnapshot): Promise<void> {
  const expected = await computeRepositoryRevision(snapshot);
  if (snapshot.revision !== expected) {
    throw new Error(
      `Native repository revision fingerprint mismatch: ${snapshot.revision} != ${expected}`,
    );
  }
}

import { describe, expect, it } from "vitest";

import { benchmarkGitScale } from "./benchmark";
import { createSyntheticGitHistory } from "./synthetic";

describe("Phase-5 scale benchmark instrumentation", () => {
  for (const commitCount of [1_000, 10_000, 100_000]) {
    it(`measures ${commitCount.toLocaleString()} commits without claiming GPU FPS`, () => {
      const dataset = createSyntheticGitHistory(commitCount);
      const result = benchmarkGitScale({
        dataset,
        camera: { position: [0, -500, 0] },
        searchQuery:
          commitCount === 100_000
            ? { text: "synthetic commit", mode: "substring", limit: 64 }
            : {
                text: `synthetic commit ${commitCount - 1}`,
                mode: "exact",
                limit: 8,
              },
        ...(commitCount === 100_000
          ? {
              fuzzyProbe: {
                text: "synthetik",
                limit: 16,
                fuzzyMaxDistance: 2,
                fuzzyDocumentBudget: 4_096,
                fuzzyTokenBudget: 16_384,
              },
            }
          : {}),
      });
      console.info(`[gitinspect-scale-benchmark] ${JSON.stringify(result)}`);

      expect(result.logicalNodeCount).toBe(commitCount + 4);
      expect(result.retainedLogicalIdentityCount).toBeLessThanOrEqual(result.logicalNodeCount);
      expect(result.renderNodeCount).toBeLessThan(result.logicalNodeCount);
      expect(result.estimatedPlanBytes).toBeLessThan(result.logicalNodeCount * 256 + 2_000_000);
      expect(result.estimatedProjectionBytes).toBeLessThan(
        result.logicalNodeCount * 128 + 2_000_000,
      );
      expect(result.estimatedSearchIndexBytes).toBeLessThan(
        result.logicalNodeCount * 2_048 + 10_000_000,
      );
      expect(result.searchHitCount).toBe(commitCount === 100_000 ? 64 : 1);
      expect(result.searchPeakRetainedResults).toBeLessThanOrEqual(commitCount === 100_000 ? 64 : 8);
      expect(result.layoutMs).toBeLessThan(15_000);
      expect(result.topologyKeyMs).toBeLessThan(15_000);
      expect(result.plannerMs).toBeLessThan(15_000);
      expect(result.projectionMs).toBeLessThan(15_000);
      expect(result.searchMs).toBeLessThan(15_000);
      expect(result.mapperMs).toBeLessThan(15_000);
      if (commitCount >= 10_000) {
        expect(result.layoutMode).toBe("macro");
        expect(result.layoutNodeCount).toBeLessThan(result.logicalNodeCount / 20);
      }
      if (commitCount === 100_000) {
        expect(result.searchMatchedDocuments).toBe(100_000);
        expect(result.searchPeakRetainedResults).toBe(64);
        expect(result.fuzzyProbe).toBeDefined();
        expect(result.fuzzyProbe!.documentsScanned).toBeLessThanOrEqual(4_096);
        expect(result.fuzzyProbe!.tokensCompared).toBeLessThanOrEqual(16_384);
        expect(result.fuzzyProbe!.elapsedMs).toBeLessThan(5_000);
      }
    }, 30_000);
  }
});

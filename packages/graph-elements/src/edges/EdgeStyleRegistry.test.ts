import type { EdgeVisualDescriptor } from "@gitinspect/contracts";
import { describe, expect, it } from "vitest";
import { EdgeStyleRegistry } from "./EdgeStyleRegistry";

const descriptor: EdgeVisualDescriptor = {
  edgeId: "edge-a",
  style: "custom",
  color: "#abcdef",
  width: 2,
};

describe("EdgeStyleRegistry", () => {
  it("resolves custom path, dotted, flow, width, opacity, and head metadata", () => {
    const registry = new EdgeStyleRegistry().withStyle("custom", {
      pattern: "dotted",
      animated: true,
      animationSpeed: 2.5,
      widthScale: 1.5,
      opacityScale: 0.5,
      pathForm: "wavy",
      head: "diamond",
    });

    expect(registry.resolve({ ...descriptor, opacity: 0.8 })).toMatchObject({
      registryStyleId: "custom",
      pattern: "dotted",
      animated: true,
      animationSpeed: 2.5,
      width: 3,
      opacity: 0.4,
      pathForm: "wavy",
      head: "diamond",
    });
  });

  it("lets descriptor flags override registry dash/animation/head decisions", () => {
    const registry = new EdgeStyleRegistry().withStyle("custom", {
      pattern: "dotted",
      animated: true,
      head: "diamond",
    });

    expect(registry.resolve({ ...descriptor, dashed: false, animated: false, head: "arrow" })).toMatchObject({
      pattern: "solid",
      animated: false,
      head: "arrow",
    });
  });

  it("falls back to the solid style for unknown registry keys without losing descriptor appearance", () => {
    const registry = new EdgeStyleRegistry();
    const resolved = registry.resolve({ ...descriptor, style: "does-not-exist", opacity: 2 });

    expect(resolved.registryStyleId).toBe("solid");
    expect(resolved.color).toBe("#abcdef");
    expect(resolved.width).toBe(2);
    expect(resolved.opacity).toBe(1);
  });
});

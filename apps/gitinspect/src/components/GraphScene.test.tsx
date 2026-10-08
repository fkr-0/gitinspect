import { describe, expect, it, vi } from "vitest";
import { bindWebGLContextLifecycle } from "./GraphScene";

describe("WebGL context lifecycle", () => {
  it("prevents permanent loss, exposes the loss state and accepts repeated recovery", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const lost = vi.fn();
    const restored = vi.fn();
    const detach = bindWebGLContextLifecycle(canvas, lost, restored);
    const event = new Event("webglcontextlost", { cancelable: true });
    expect(canvas.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(lost).toHaveBeenCalledTimes(1);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(restored).toHaveBeenCalledTimes(2);
    detach();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(lost).toHaveBeenCalledTimes(1);
    expect(restored).toHaveBeenCalledTimes(2);
  });
});

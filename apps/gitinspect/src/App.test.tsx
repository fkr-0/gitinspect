import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("gitinspect application shell", () => {
  it("renders the studio chrome without a browser or native Tauri runtime", () => {
    const html = renderToStaticMarkup(<App autoOpenDemo={false} />);

    expect(html).toContain("gitinspect");
    expect(html).toContain("3D graph viewport");
    expect(html).toContain("Repository path");
    expect(html).toContain("Transaction tray");
    expect(html).toContain("Apply to repository");
    expect(html).toContain("disabled");
  });
});

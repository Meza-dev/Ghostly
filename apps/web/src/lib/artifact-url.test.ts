import { describe, expect, it } from "vitest";
import { artifactUrl } from "./artifact-url";

describe("artifact URL", () => {
  it.each([
    "artifacts/run-abc/step-1-ok.png",
    "C:\\custom-storage\\run-abc\\step-1-ok.png",
    "/opt/artifacts/dist/artifacts/run-abc/step-1-ok.png",
    "run-abc/step-1-ok.png",
  ])("keeps the run folder for %s", (file) => {
    expect(artifactUrl(file, "fixture token")).toBe("/artifacts/run-abc/step-1-ok.png?token=fixture%20token");
  });

  it("encodes the filename and rejects dot segments", () => {
    expect(artifactUrl("/opt/store/run-abc/a #.webm", null)).toBe("/artifacts/run-abc/a%20%23.webm");
    expect(artifactUrl("run-abc/page@fixture.webm", null)).toBe("/artifacts/run-abc/page%40fixture.webm");
    expect(artifactUrl("run-abc/..", null)).toBeUndefined();
  });
});

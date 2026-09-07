import { describe, expect, it } from "vitest";
import {
  createLocalMotionPlan,
  localMotionFilter,
  planLocalMotionSequence,
} from "@/lib/video-composer/local-motion";
import { buildComposeCommand } from "@/lib/video-composer/composer";

describe("local image motion planner", () => {
  it("reads concrete Chinese camera directions before the shot-type fallback", () => {
    expect(createLocalMotionPlan({ camera: "镜头急速推近出风口", shotType: "cta" }).kind).toBe("push_in_fast");
    expect(createLocalMotionPlan({ camera: "镜头沿弧线环拍四分之一圈", shotType: "cta" }).kind).toBe("arc");
    expect(createLocalMotionPlan({ camera: "镜头静止，主体保持稳定", shotType: "hook" }).kind).toBe("hold");
  });

  it("keeps automatic adjacent shots from repeating the same move", () => {
    const plans = planLocalMotionSequence([
      { shotId: 1, camera: "缓慢推近", shotType: "hook" },
      { shotId: 2, camera: "缓慢推近", shotType: "demo" },
      { shotId: 3, camera: "缓慢推近", shotType: "social_proof" },
    ]);
    expect(plans[0].kind).toBe("push_in");
    expect(plans[1].kind).not.toBe(plans[0].kind);
    expect(plans[2].kind).toBe("push_in");
  });

  it("honors a per-shot override and caps product-safe zoom", () => {
    const safe = createLocalMotionPlan({ override: "macro_push", intensity: "strong", productSafe: true });
    const free = createLocalMotionPlan({ override: "macro_push", intensity: "strong", productSafe: false });
    expect(safe.kind).toBe("macro_push");
    expect(safe.zoomEnd).toBeLessThanOrEqual(1.22);
    expect(free.zoomEnd).toBeGreaterThan(safe.zoomEnd);
  });

  it("compiles eased, finite zoompan expressions with the requested duration", () => {
    const plan = createLocalMotionPlan({ override: "push_in_fast", productSafe: true });
    const filter = localMotionFilter(plan, 1440, 2560, 3.2);
    expect(filter).toContain("zoompan=");
    expect(filter).toContain("d=96");
    expect(filter).toContain("pow");
    expect(filter).not.toMatch(/NaN|Infinity/);
  });

  it("wires a product-safe plan into the composer with a blurred aspect-fill layer", () => {
    const command = buildComposeCommand({
      projectId: "motion-integration",
      clips: [{
        type: "image",
        filePath: "/data/product.png",
        duration: 3,
        transition: "direct_concat",
        motionPlan: createLocalMotionPlan({ override: "arc", productSafe: true }),
      }],
      output: { resolution: "720p", aspectRatio: "9:16" },
    });
    expect(command).toContain("split=2");
    expect(command).toContain("boxblur=20:1");
    expect(command).toContain("sin(PI*");
    expect(command).toContain("zoompan=");
  });
});

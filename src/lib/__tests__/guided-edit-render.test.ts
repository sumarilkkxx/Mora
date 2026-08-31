import { describe, expect, it } from "vitest";
import { buildGuidedRenderInvocation } from "@/lib/guided-edit-render";
import { DEFAULT_GUIDED_EDIT_BRIEF, type GuidedEditPlanDocument } from "@/lib/guided-edit";

function document(audioMode: "original" | "muted" | "uploaded_voice" | "local_voice"): GuidedEditPlanDocument {
  return {
    version: 1,
    brief: {
      ...DEFAULT_GUIDED_EDIT_BRIEF,
      inputMode: "full_script",
      projectName: "test",
      productName: "product",
      promotionGoal: "",
      fullScript: "one",
      hook: "",
      introduction: "",
      sellingPoints: [""],
      proof: "",
      usageScene: "",
      cta: "",
      targetDuration: 15,
      aspectRatio: "9:16",
      audioMode,
      burnSubtitles: true,
      captionSize: "medium",
      captionLanguage: "auto",
    },
    scenes: [{ id: "s1", start: 1, end: 4, label: "highlight", selected: true }],
    beats: [{ id: "b1", role: "hook", text: "one", estimatedDuration: 3, sceneIds: ["s1"] }],
    timeline: [{ id: "c1", sourceId: "src", sceneId: "s1", beatId: "b1", start: 1, end: 4, outputStart: 0, outputEnd: 3 }],
    outputDuration: 3,
  };
}

describe("guided edit render invocation", () => {
  it("normalizes portrait output and maps source audio when requested", () => {
    const invocation = buildGuidedRenderInvocation({ sourcePath: "in.mp4", outputPath: "out.mp4", document: document("original"), sourceHasAudio: true });
    expect(invocation.filterComplex).toContain("scale=1080:1920");
    expect(invocation.filterComplex).toContain("atrim=start=1.000:end=4.000");
    expect(invocation.outputArgs).toContain("[acat]");
  });

  it("creates a video-only invocation in muted mode", () => {
    const invocation = buildGuidedRenderInvocation({ sourcePath: "in.mp4", outputPath: "out.mp4", document: document("muted"), sourceHasAudio: true, subtitlePath: "sub.ass" });
    expect(invocation.filterComplex).not.toContain("atrim=");
    expect(invocation.filterComplex).toContain("subtitles=");
    expect(invocation.outputArgs).not.toContain("[acat]");
  });

  it("uses uploaded narration as the output audio track", () => {
    const invocation = buildGuidedRenderInvocation({ sourcePath: "in.mp4", outputPath: "out.mp4", document: document("uploaded_voice"), sourceHasAudio: true, voiceoverPath: "voice.mp3" });
    expect(invocation.inputArgs).toContain("voice.mp3");
    expect(invocation.filterComplex).toContain("[1:a:0]");
    expect(invocation.outputArgs).toContain("[avoice]");
    expect(invocation.filterComplex).not.toContain("[0:a:0]");
  });

  it("uses generated local narration through the same deterministic audio path", () => {
    const invocation = buildGuidedRenderInvocation({ sourcePath: "in.mp4", outputPath: "out.mp4", document: document("local_voice"), sourceHasAudio: true, voiceoverPath: "local.wav" });
    expect(invocation.inputArgs).toContain("local.wav");
    expect(invocation.outputArgs).toContain("[avoice]");
  });

  it("applies real slow motion and a gradual zoom for the slow-push style", () => {
    const styled = document("original");
    styled.brief.editStyle = "slow_zoom";
    const invocation = buildGuidedRenderInvocation({ sourcePath: "in.mp4", outputPath: "out.mp4", document: styled, sourceHasAudio: true });
    expect(invocation.filterComplex).toContain("setpts=(PTS-STARTPTS)/0.88");
    expect(invocation.filterComplex).toContain("atempo=0.88");
    expect(invocation.filterComplex).toContain("zoompan=z='min(zoom+0.0007,1.08)'");
  });

  it("alternates zoom direction for the dynamic-focus style", () => {
    const styled = document("muted");
    styled.brief.editStyle = "dynamic_focus";
    styled.timeline.push({ ...styled.timeline[0], id: "c2", outputStart: 3, outputEnd: 6 });
    styled.outputDuration = 6;
    const invocation = buildGuidedRenderInvocation({ sourcePath: "in.mp4", outputPath: "out.mp4", document: styled, sourceHasAudio: true });
    expect(invocation.filterComplex).toContain("min(zoom+0.0013,1.12)");
    expect(invocation.filterComplex).toContain("max(zoom-0.0013,1.0)");
  });

  it("maps the additional styles to distinct render filters", () => {
    const pan = document("muted");
    pan.brief.editStyle = "product_pan";
    const panFilter = buildGuidedRenderInvocation({ sourcePath: "in.mp4", outputPath: "out.mp4", document: pan, sourceHasAudio: true }).filterComplex;
    expect(panFilter).toContain("zoompan=z='1.06'");
    expect(panFilter).toContain("on*(iw-iw/zoom)");

    const handheld = document("muted");
    handheld.brief.editStyle = "handheld";
    const handheldFilter = buildGuidedRenderInvocation({ sourcePath: "in.mp4", outputPath: "out.mp4", document: handheld, sourceHasAudio: true }).filterComplex;
    expect(handheldFilter).toContain("sin(n*0.17)");
    expect(handheldFilter).toContain("cos(n*0.13)");

    const impact = document("muted");
    impact.brief.editStyle = "impact";
    const impactFilter = buildGuidedRenderInvocation({ sourcePath: "in.mp4", outputPath: "out.mp4", document: impact, sourceHasAudio: true }).filterComplex;
    expect(impactFilter).toContain("if(lt(on,8)");
  });
});

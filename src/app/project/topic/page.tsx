"use client";

import { PageHeader } from "@/components/studio/page";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LuCircleAlert, LuLoaderCircle, LuWandSparkles } from "react-icons/lu";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useT } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/ui/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// narration styles (one-to-one correspondence with the backend TopicNarrationStyle); label/desc resolved per locale at render time
const narrationStyleValues = ["knowledge", "story", "lifestyle", "inspiration", "travel"] as const;

// duration options (label is a plain unit string, no translation needed)
const durationOptions = [
  { value: "15", label: "15s" },
  { value: "25", label: "25s" },
  { value: "40", label: "40s" },
];

// topic inspiration examples (zero-barrier trial for beginners); copy resolved per locale; key order matches the render below
const exampleTopicKeys = ["exampleTopic1", "exampleTopic2", "exampleTopic3", "exampleTopic4", "exampleTopic5"];

export default function TopicProjectPage() {
  const t = useT("topic");
  const router = useRouter();
  const { llm } = useSettingsStore();
  const isLLMConfigured = llm.apiKey.length > 0;

  const [topic, setTopic] = useState("");
  const [narrationStyle, setNarrationStyle] = useState("knowledge");
  const [duration, setDuration] = useState("25");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = topic.trim().length >= 2;

  const handleGenerate = async () => {
    if (!isValid || isSubmitting) return;
    if (!isLLMConfigured) {
      setError(t("errorNoLlm"));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/topic/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          narrationStyle,
          targetDuration: Number(duration),
          llmConfig: {
            baseUrl: llm.baseUrl,
            apiKey: llm.apiKey,
            model: llm.model,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // even on failure, the backend may have created a draft project and returned a projectId so the user can retry after navigating
        if (data.projectId) {
          router.push(`/project/${data.projectId}/script`);
          return;
        }
        throw new Error(data.error || t("errorGenerateCheckLlm"));
      }
      // success: navigate to the script page to review multiple options, then proceed through auto-fill assets → compose
      router.push(`/project/${data.projectId}/script`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorGenerate"));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid-bg legacy-studio-page">
      <main className="studio-page max-w-2xl">
        {/* page title */}
        <PageHeader title={t("heroTitle")} description={t("heroSubtitle")} />

        {/* LLM not configured guidance */}
        {!isLLMConfigured && (
          <Link href="/settings?tab=llm">
            <Notice tone="warning" title={t("llmBannerTitle")} className="mb-6 transition-colors hover:brightness-[.98]">
              {t("llmBannerDesc")} <span className="font-medium underline underline-offset-2">{t("llmBannerCta")}</span>
            </Notice>
          </Link>
        )}

        <Card className="glass-card">
          <CardContent className="p-6 space-y-6">
            {/* topic input */}
            <div className="space-y-2">
              <Label htmlFor="topic" className="text-sm font-medium">
                {t("topicLabel")} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={t("topicPlaceholder")}
                rows={3}
                className="resize-none"
              />
              {/* inspiration examples */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-xs text-muted-foreground self-center">{t("tryLabel")}</span>
                {exampleTopicKeys.map((key) => {
                  const text = t(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTopic(text)}
                      className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
                    >
                      {text}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* narration style */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("narrationLabel")}</Label>
              <Select value={narrationStyle} onValueChange={(val) => setNarrationStyle(val ?? "knowledge")}>
                <SelectTrigger>
                  {/* Base UI's Select.Value shows the raw value by default; use a function child to map it to the translated label */}
                  <SelectValue>
                    {(value: string) => t(`narration_${value}_label`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {narrationStyleValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`narration_${value}_label`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* description for the selected style (placed outside the Select to avoid the trigger showing the raw value) */}
              <p className="text-xs text-muted-foreground">
                {t(`narration_${narrationStyle}_desc`)}
              </p>
            </div>

            {/* duration */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("durationLabel")}</Label>
              <div className="flex gap-2">
                {durationOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={duration === o.value}
                    onClick={() => setDuration(o.value)}
                    className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      duration === o.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* error message */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                <LuCircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* generate button */}
            <Button
              onClick={handleGenerate}
              disabled={!isValid || isSubmitting}
              className="w-full brand-gradient text-white"
              size="lg"
            >
              {isSubmitting ? (
                <>
                  <LuLoaderCircle className="w-4 h-4 animate-spin" />
                  <span className="ml-1.5">{t("generatingScript")}</span>
                </>
              ) : (
                <>
                  <LuWandSparkles className="w-4 h-4" />
                  <span className="ml-1.5">{t("ctaGenerate")}</span>
                </>
              )}
            </Button>

            {/* workflow hints */}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
              <Badge variant="secondary" className="text-[10px]">{t("flowStep1")}</Badge>
              <span className="text-border">→</span>
              <Badge variant="secondary" className="text-[10px]">{t("flowStep2")}</Badge>
              <span className="text-border">→</span>
              <Badge variant="secondary" className="text-[10px]">{t("flowStep3")}</Badge>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

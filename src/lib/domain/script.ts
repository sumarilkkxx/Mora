/** Video mode: determines the asset generation strategy. */
export type VideoMode =
  | "product_closeup"
  | "graphic_montage"
  | "scene_demo"
  | "live_presenter";

/** A script-local character, distinct from the reusable presenter library. */
export interface ScriptCharacter {
  id: string;
  name: string;
  gender: "female" | "male";
  persona?: string;
  appearance?: string;
}

export interface Shot {
  shotId: number;
  type: "hook" | "pain_point" | "product_reveal" | "demo" | "social_proof" | "cta";
  duration: number;
  description: string;
  camera: string;
  visualSource: "ai_generate" | "product_image" | "user_upload";
  transition: "ai_start_end" | "ai_reference" | "direct_concat" | "ffmpeg_fade";
  voiceover: string;
  prompt?: string;
  stockKeywords?: string[];
  characterId?: string;
  motion?: "zoom_in_slow" | "pan_left" | "pan_right" | "ken_burns" | "static";
  textOverlay?: {
    text: string;
    style: "title" | "subtitle" | "highlight" | "price";
  };
}

export interface CharacterVoiceProfile {
  style: string;
  speed?: number;
  emotion?: "neutral" | "happy" | "serious" | "energetic";
}

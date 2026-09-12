import {
  Bell,
  CircleCheck,
  CircleX,
  ContactRound,
  FolderKanban,
  Info,
  Layers3,
  ListVideo,
  Package,
  ScanSearch,
  Scissors,
  Settings2,
  SquarePen,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

/** Shared optical defaults for Mora's 24px, stroke-based interface icons. */
export const ICON_STROKE_WIDTH = 1.8;

/**
 * Product-level concepts have one stable glyph. Feature code should reuse this
 * map instead of choosing another icon for the same destination.
 */
export const navigationIcons = {
  create: SquarePen,
  projects: FolderKanban,
  tasks: Bell,
  products: Package,
  presenters: ContactRound,
  mediaLab: ScanSearch,
  edit: Scissors,
  clone: Layers3,
  batch: ListVideo,
  settings: Settings2,
} as const satisfies Record<string, LucideIcon>;

/** Status glyphs always pair shape with semantic color and text. */
export const statusIcons = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
} as const satisfies Record<string, LucideIcon>;

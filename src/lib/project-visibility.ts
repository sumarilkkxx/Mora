import { eq } from "drizzle-orm";
import { projects } from "@/lib/db/schema";

/** One reusable condition for every product-facing cross-project feed. */
export function userVisibleProjects() {
  return eq(projects.isInternal, false);
}

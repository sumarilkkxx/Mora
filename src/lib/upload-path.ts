import { realpathSync, statSync } from "fs";
import { isAbsolute, relative, resolve, sep } from "path";
import { getUploadsDir } from "@/lib/paths";

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return !!rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Resolve only local upload URLs; reject traversal before touching the disk. */
export function resolveUploadFilePath(ref: string): string | null {
  if (typeof ref !== "string" || !ref.startsWith("/api/files/")) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(ref.slice("/api/files/".length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const parts = pathname.replace(/\\/g, "/").split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[:\0]/.test(part))) return null;
  const root = resolve(getUploadsDir());
  const candidate = resolve(root, ...parts);
  return isInside(root, candidate) ? candidate : null;
}

/** Resolve an existing regular file and reject symlinks/junctions escaping uploads. */
export function resolveExistingUploadFilePath(ref: string): string | null {
  const candidate = resolveUploadFilePath(ref);
  if (!candidate) return null;
  try {
    const root = realpathSync(getUploadsDir());
    const actual = realpathSync(candidate);
    return isInside(root, actual) && statSync(actual).isFile() ? actual : null;
  } catch {
    return null;
  }
}

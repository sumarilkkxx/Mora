/** Browser storage keys are kept separate from the full template catalog. */
export function adTemplateStorageKey(projectId: string): string {
  return `mora-ad-template:${projectId}`;
}

export function adTemplateAppliedKey(projectId: string): string {
  return `mora-ad-template-applied:${projectId}`;
}

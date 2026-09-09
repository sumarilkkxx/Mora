import AutoEditWorkspace from "@/components/auto-edit-workspace";

export default async function AutoEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AutoEditWorkspace projectId={id} />;
}

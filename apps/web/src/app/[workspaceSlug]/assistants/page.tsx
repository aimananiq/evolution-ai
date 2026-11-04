import { requireMember } from "@/lib/tenancy";
import { listAssistants } from "@/lib/assistant-data";
import AssistantsList from "./assistants-list";

export default async function AssistantsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const assistants = await listAssistants(workspace.id);
  return <AssistantsList workspaceSlug={workspaceSlug} initial={assistants} />;
}

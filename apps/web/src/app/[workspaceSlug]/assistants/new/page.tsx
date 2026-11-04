import { requireMember } from "@/lib/tenancy";
import { connectedInstances } from "@/lib/assistant-data";
import Wizard from "./wizard";

export default async function NewAssistant({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const instances = await connectedInstances(workspace.id);
  return <Wizard workspaceSlug={workspaceSlug} instances={instances} />;
}

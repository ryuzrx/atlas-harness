import { api, pickFolder, Project } from "../api";
import { useStore } from "../store";
import { useAction } from "./ui";

/** Existing add-project flow (native folder picker → POST /projects), shared by the sidebar and Projects page. */
export function useAddProject() {
  const { activeWorkspace, go } = useStore();
  const { busy, run } = useAction();
  const add = async () => {
    const path = await pickFolder();
    if (!path) return;
    const p = await run("a", () => api<Project>("/projects", { body: { path, workspace: activeWorkspace } }), "Project added");
    if (p) go({ name: "projects", id: p.id });
  };
  return { add, adding: busy === "a" };
}

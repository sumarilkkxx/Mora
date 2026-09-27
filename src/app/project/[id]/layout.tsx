import { ProjectRouteHeader } from "@/components/project-route-header";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="contents" data-project-workspace>
      <ProjectRouteHeader />
      {children}
    </div>
  );
}

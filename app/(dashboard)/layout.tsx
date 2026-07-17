import { Sidebar } from "@/components/Sidebar";
import { ChatDock } from "@/components/ChatDock";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 max-w-[1200px] px-8 py-8 mx-auto">{children}</main>
      <ChatDock />
    </div>
  );
}

import { ChatShell } from "@/components/chat/chat-shell";
import { getAuthSession } from "@/lib/auth/session";
import { getSidebarConversations } from "@/lib/get-sidebar-conversations";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getAuthSession();
  if (!session) {
    return null;
  }

  const initialConversations = await getSidebarConversations(session.userId);

  return (
    <ChatShell
      initialConversations={initialConversations}
      viewer={{
        displayName: session.displayName,
        username: session.username,
        isAdmin: session.role === "ADMIN",
        canManageMembers: session.canManageMembers,
      }}
    />
  );
}

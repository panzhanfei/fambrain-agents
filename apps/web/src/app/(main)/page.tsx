import { ChatShell } from "@/components/chat/chat-shell";
import { getAuthSession } from "@fambrain/auth";
import { getSidebarConversations } from "@fambrain/db";
export const dynamic = "force-dynamic";
const Home = async () => {
    const session = await getAuthSession();
    if (!session) {
        return null;
    }
    const initialConversations = await getSidebarConversations(session.userId);
    return (<ChatShell initialConversations={initialConversations} viewer={{
            displayName: session.displayName,
            username: session.username,
            isAdmin: session.role === "ADMIN",
            canManageMembers: session.canManageMembers,
        }}/>);
};
export default Home;

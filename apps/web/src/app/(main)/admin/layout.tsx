import { getAuthSession } from "@fambrain/auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
const AdminGateLayout = async ({ children }: {
    children: ReactNode;
}) => {
    const session = await getAuthSession();
    if (!session)
        redirect("/login");
    if (!session.canManageMembers)
        redirect("/me");
    return children;
};
export default AdminGateLayout;

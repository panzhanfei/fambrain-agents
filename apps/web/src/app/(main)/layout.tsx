import { getAuthSession } from "@fambrain/auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
const ActiveMemberLayout = async ({ children }: {
    children: ReactNode;
}) => {
    const session = await getAuthSession();
    if (!session)
        redirect("/login");
    if (session.status === "REJECTED") {
        redirect("/login?reason=rejected");
    }
    if (session.status === "PENDING") {
        redirect("/pending");
    }
    return children;
};
export default ActiveMemberLayout;

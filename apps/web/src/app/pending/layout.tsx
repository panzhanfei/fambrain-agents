import { getAuthSession } from "@fambrain/auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
const PendingLayout = async ({ children }: {
    children: ReactNode;
}) => {
    const session = await getAuthSession();
    if (!session)
        redirect("/login");
    if (session.status === "ACTIVE")
        redirect("/");
    if (session.status === "REJECTED")
        redirect("/login?reason=rejected");
    return children;
};
export default PendingLayout;

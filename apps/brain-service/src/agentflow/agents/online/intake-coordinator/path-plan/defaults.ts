import type { ComposeMode, PathPlan } from "./interface";

export const emptyPathPlan = (): PathPlan => ({
    km: [],
    list: [],
    tool: [],
    dag: [],
});

export const defaultComposeMode = (): ComposeMode => "qa";

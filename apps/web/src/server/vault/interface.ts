export type WorkspaceFileRead =
  | { ok: true; text: string }
  | { ok: false; error: string };

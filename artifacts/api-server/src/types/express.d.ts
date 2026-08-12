import "express-session";
import type { UserRole } from "@workspace/db";

declare module "express-session" {
  interface SessionData {
    userId: string;
    tenantId: string;
    role: UserRole;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** VoxAgent organisation derived from the authenticated session */
      tenantId?: string;
      /** Authenticated user ID */
      userId?: string;
      /** Role of the authenticated user in this tenant */
      userRole?: UserRole;
    }
  }
}

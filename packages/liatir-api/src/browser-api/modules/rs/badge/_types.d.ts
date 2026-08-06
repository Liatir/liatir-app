/** Shapes for the dock/taskbar count badge. */
import type { U32 } from "../../../utils/utils/_integerUtils";
export interface BadgeInterface {
    set: (count: U32) => Promise<void>;
    clear: () => Promise<void>;
}

import { eq } from "drizzle-orm";
import { db, type Conn } from "@/db";
import { appSetting } from "@/db/schema";

/** Defaults are configurable placeholders, not City/County policy. */
export const SETTING_DEFAULTS = {
  "renewal.reminderDays": [180, 120, 90, 60, 30] as number[],
  "documents.maxBytes": 25 * 1024 * 1024,
  "documents.allowedExtensions": ["pdf", "docx", "doc", "xlsx", "txt", "png", "jpg", "jpeg"] as string[],
  "tasks.reminderEveryDays": 2,
  "tasks.escalateAfterDaysOverdue": 2,
  "retention.note": "Retention periods are not set. Configure per City/County records schedule after Legal review.",
  "sod.requesterCannotApprove": true,
};
export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting<K extends SettingKey>(key: K, conn: Conn = db): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const [row] = await conn.select().from(appSetting).where(eq(appSetting.key, key)).limit(1);
  return (row?.value as (typeof SETTING_DEFAULTS)[K]) ?? SETTING_DEFAULTS[key];
}

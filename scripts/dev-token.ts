// Development helper: prints a session cookie value for a demo user (e.g. "priya").
import "./load-env";
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/db";
import { user } from "@/db/schema";
import { signSession } from "@/lib/auth/token";

async function main() {
  const key = process.argv[2] ?? "priya";
  const [u] = await db.select().from(user).where(eq(user.email, `${key}@demo.clm.invalid`));
  console.log(await signSession(u.id, "dev"));
  await closeDb();
}
main();

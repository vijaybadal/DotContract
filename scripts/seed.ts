import "./load-env";
import { closeDb } from "@/db";
import { seedDatabase } from "@/db/seed";

seedDatabase()
  .then(async () => {
    console.log("Seeded demonstration data (synthetic).");
    await closeDb();
  })
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });

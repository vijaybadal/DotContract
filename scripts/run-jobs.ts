import "./load-env";
import { closeDb } from "@/db";
import { runAllJobs } from "@/lib/jobs";

runAllJobs()
  .then(async (s) => {
    console.log(JSON.stringify(s, null, 2));
    await closeDb();
  })
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });

// On StackBlitz the precompiled stylesheet is used (see next.config.ts), so Tailwind's native compiler
// is never loaded there.
const stackblitz = process.env.CLM_STACKBLITZ === "1" || Boolean(process.versions.webcontainer) || process.env.SHELL === "/bin/jsh";
export default { plugins: stackblitz ? {} : { "@tailwindcss/postcss": {} } };

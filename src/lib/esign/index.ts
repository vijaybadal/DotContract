import { DocuSignProvider } from "./docusign";
import { MockESignProvider } from "./mock";
import type { ESignProvider } from "./provider";

export function getESignProvider(): ESignProvider {
  switch (process.env.ESIGN_PROVIDER) {
    case "docusign":
      return new DocuSignProvider();
    case "mock":
    default:
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_ESIGN !== "true") {
        return new DocuSignProvider(); // never silently fall back to the mock in production
      }
      return new MockESignProvider();
  }
}
export type { ESignProvider } from "./provider";

/**
 * Malware scanning integration point. The development scanner only recognizes the EICAR test
 * string; it is NOT antivirus. Production: ClamAV (clamd) or the County's file-scanning service.
 */
export type ScanResult = { status: "CLEAN" | "INFECTED"; engine: string; signature?: string };
export interface Scanner {
  scan(bytes: Buffer): Promise<ScanResult>;
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export class DevScanner implements Scanner {
  async scan(bytes: Buffer): Promise<ScanResult> {
    if (bytes.includes(Buffer.from(EICAR))) return { status: "INFECTED", engine: "dev-eicar", signature: "EICAR-Test-File" };
    return { status: "CLEAN", engine: "dev-eicar" };
  }
}

export function getScanner(): Scanner {
  return new DevScanner();
}

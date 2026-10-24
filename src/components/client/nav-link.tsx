"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, children, count, exact }: { href: string; children: ReactNode; count?: number; exact?: boolean }) {
  const path = usePathname();
  const active = href === "/" || exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between rounded px-3 py-1.5 text-[0.875rem] ${
        active ? "bg-white/10 font-semibold text-white shadow-[inset_3px_0_0_#7fb8c4]" : "text-[#c5ccd4] hover:bg-white/5 hover:text-white"
      }`}
    >
      <span>{children}</span>
      {count ? <span className="rounded bg-[#7fb8c4] px-1.5 text-[0.7rem] font-bold leading-5 text-[#10202a]">{count}</span> : null}
    </Link>
  );
}

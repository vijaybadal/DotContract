import Link from "next/link";
import { Bell, Search } from "lucide-react";
import { requireActor, authMode } from "@/lib/auth/session";
import { canAdministerWorkflows, getOrgIndex, isSystemAdmin, hasRole } from "@/lib/authz";
import { listEligibleTasks } from "@/lib/workflow";
import { unreadCount } from "@/lib/notifications";
import { NavLink } from "@/components/client/nav-link";
import { signOut } from "@/app/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const idx = await getOrgIndex();
  const [tasks, unread] = await Promise.all([listEligibleTasks(actor), unreadCount(actor.id)]);
  const admin = canAdministerWorkflows(actor, idx) || isSystemAdmin(actor, idx) || hasRole(actor, "AUTHORITY_ADMIN", idx);
  const roles = [...new Set(actor.assignments.map((a) => a.roleKey.replace(/_/g, " ").toLowerCase()))];

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="hidden w-60 shrink-0 bg-ink md:block">
      <aside className="sticky top-0 flex h-screen flex-col overflow-y-auto px-3 py-4">
        <Link href="/" className="mb-6 block px-3">
          <span className="block text-[1.05rem] font-bold tracking-tight text-white">DOTComm Contracts</span>
          <span className="block text-[0.75rem] text-[#9aa5b1]">City of Omaha · Douglas County</span>
        </Link>
        <NavSections tasks={tasks.length} admin={admin} />
        {authMode() === "dev" && (
          <p className="mt-auto rounded border border-[#3a4552] px-3 py-2 text-[0.72rem] leading-snug text-[#9aa5b1]">
            Demonstration environment. All people, vendors, amounts and signing authorities are synthetic.
          </p>
        )}
      </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-rule bg-canvas/95 px-4 py-2.5 backdrop-blur md:px-8">
          <details className="relative md:hidden">
            <summary className="cursor-pointer list-none rounded border border-rule bg-panel px-2.5 py-1.5 text-sm font-semibold">Menu</summary>
            <div className="absolute left-0 z-20 mt-1 w-64 rounded-md bg-ink p-3 shadow-lg">
              <NavSections tasks={tasks.length} admin={admin} label="Mobile" />
            </div>
          </details>
          <form action="/contracts" className="relative ml-auto w-full max-w-sm md:ml-0" role="search">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
            <label htmlFor="global-search" className="sr-only">Search contracts</label>
            <input id="global-search" name="q" placeholder="Search contracts, vendors, numbers" className="input pl-8" />
          </form>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/notifications" className="relative rounded p-1.5 text-ink-soft hover:bg-white" aria-label={`Notifications, ${unread} unread`}>
              <Bell className="h-5 w-5" />
              {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red px-1.5 text-[0.65rem] font-bold leading-4 text-white">{unread}</span>}
            </Link>
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-2 py-1 hover:bg-white">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-teal text-[0.8rem] font-bold text-white" aria-hidden>
                  {actor.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-sm font-semibold">{actor.name}</span>
                  <span className="block text-[0.75rem] text-muted">{idx.path(actor.primaryOrgId)}</span>
                </span>
              </summary>
              <div className="absolute right-0 mt-1 w-72 rounded-md border border-rule bg-panel p-3 text-sm shadow-lg">
                <p className="font-semibold">{actor.title}</p>
                <p className="mt-1 text-muted">Roles: {roles.join(", ")}</p>
                <div className="mt-3 flex gap-2 border-t border-rule pt-3">
                  {authMode() === "dev" && <Link href="/login" className="font-semibold text-teal hover:underline">Switch demo user</Link>}
                  <form action={signOut} className="ml-auto">
                    <button className="font-semibold text-teal hover:underline">Sign out</button>
                  </form>
                </div>
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavSections({ tasks, admin, label = "Primary" }: { tasks: number; admin: boolean; label?: string }) {
  return (
    <nav aria-label={label} className="space-y-5">
      <div className="space-y-0.5">
        <NavLink href="/">Dashboard</NavLink>
        <NavLink href="/tasks" count={tasks}>My tasks & approvals</NavLink>
        <NavLink href="/requests">Contract requests</NavLink>
      </div>
      <div className="space-y-0.5">
        <p className="px-3 pb-1 text-[0.72rem] font-semibold text-[#8793a0]">Lifecycle</p>
        <NavLink href="/contracts">Contracts</NavLink>
        <NavLink href="/legal">Legal review</NavLink>
        <NavLink href="/signatures">Signatures</NavLink>
        <NavLink href="/renewals">Renewals</NavLink>
      </div>
      <div className="space-y-0.5">
        <p className="px-3 pb-1 text-[0.72rem] font-semibold text-[#8793a0]">Portfolio</p>
        <NavLink href="/saas">SaaS & licenses</NavLink>
        <NavLink href="/vendors">Vendors</NavLink>
        <NavLink href="/financials">Financials</NavLink>
        <NavLink href="/obligations">Obligations</NavLink>
        <NavLink href="/reports">Reports</NavLink>
      </div>
      {admin && (
        <div className="space-y-0.5">
          <p className="px-3 pb-1 text-[0.72rem] font-semibold text-[#8793a0]">Administration</p>
          <NavLink href="/admin" exact>Organizations & roles</NavLink>
          <NavLink href="/admin/workflows">Approval workflows</NavLink>
          <NavLink href="/admin/signing-authority">Signing authority</NavLink>
          <NavLink href="/admin/audit">Audit log</NavLink>
        </div>
      )}
    </nav>
  );
}

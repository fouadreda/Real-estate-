"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { User } from "@prisma/client";
import type { Dictionary } from "@/lib/i18n";
import { logout } from "@/lib/actions/auth";
import Avatar from "@/components/Avatar";

export default function Nav({
  user,
  nav,
  alertCount,
}: {
  user: User;
  nav: Dictionary["nav"];
  alertCount: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const links = [
    { href: "/", label: nav.dashboard },
    { href: "/properties", label: nav.properties },
    { href: "/tenants", label: nav.tenants },
    { href: "/leases", label: nav.leases },
    { href: "/expenses", label: nav.expenses },
    { href: "/reports", label: nav.reports },
  ];

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="shrink-0 text-lg font-semibold text-stone-900">
          Les <span className="text-brand-600">Cocotiers</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium hover:bg-stone-100 hover:text-stone-900 ${
                isActive(link.href) ? "text-stone-900" : "text-stone-600"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/alerts"
            className={`relative rounded-lg px-3 py-2 text-sm font-medium hover:bg-stone-100 hover:text-stone-900 ${
              isActive("/alerts") ? "text-stone-900" : "text-stone-600"
            }`}
          >
            {nav.alerts}
            {alertCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {alertCount}
              </span>
            )}
          </Link>
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/settings" className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-stone-100">
            <Avatar name={user.name} size="sm" />
            <span className="text-left">
              <p className="text-sm font-medium leading-tight text-stone-900">{user.name}</p>
              <p className="text-xs leading-tight text-stone-500">{user.role === "ADMIN" ? nav.admin : nav.manager}</p>
            </span>
          </Link>
          <form action={logout}>
            <button type="submit" className="btn-secondary">{nav.signOut}</button>
          </form>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          {alertCount > 0 && (
            <Link
              href="/alerts"
              className="relative rounded-lg p-2 text-stone-600 hover:bg-stone-100"
              aria-label={nav.alerts}
            >
              <BellIcon />
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {alertCount}
              </span>
            </Link>
          )}
          <Link href="/settings" aria-label={nav.settings}>
            <Avatar name={user.name} size="sm" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg p-2 text-stone-600 hover:bg-stone-100"
            aria-label={open ? nav.closeMenu : nav.openMenu}
            aria-expanded={open}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-stone-200 px-4 py-3 lg:hidden">
          <ul className="space-y-0.5">
            {[...links, { href: "/alerts", label: nav.alerts }, { href: "/settings", label: nav.settings }].map(
              (link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-stone-100 ${
                      isActive(link.href) ? "bg-stone-100 text-stone-900" : "text-stone-600"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
          <form action={logout} className="mt-2 border-t border-stone-200 pt-3">
            <button type="submit" className="btn-secondary w-full">{nav.signOut}</button>
          </form>
        </nav>
      )}
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

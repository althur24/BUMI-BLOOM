"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/import", label: "Import Produk" },
  { href: "/subscribers", label: "Subscribers" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return null;

  async function handleSignOut() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="admin-nav-wrap">
      <nav className="admin-nav">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`admin-nav__link ${pathname === l.href ? "admin-nav__link--active" : ""}`}
          >
            {l.label}
          </Link>
        ))}
        <button
          className="admin-nav__signout"
          onClick={handleSignOut}
          aria-label="Sign out"
        >
          Sign out
        </button>
      </nav>
    </div>
  );
}

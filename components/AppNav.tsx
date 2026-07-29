'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChartBarIcon,
  ChartLineUpIcon,
  CoinsIcon,
  PackageIcon,
  ReceiptIcon,
  StorefrontIcon,
  TagIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react';

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
}

/**
 * The nav lists live HERE, in the client module, rather than in the layouts
 * that render it.
 *
 * They used to be defined in each layout and passed in as a prop, with icons
 * imported from @phosphor-icons/react/dist/ssr. Those are plain server
 * components with no 'use client' directive, so React cannot serialise them
 * into a client component's props — every page rendered a 500 reading
 * "Functions cannot be passed directly to Client Components". Nothing crosses
 * the boundary now: this file imports its own icons from the client entry point
 * and the layout passes a string.
 */
const OWNER_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: ChartLineUpIcon },
  { href: '/products', label: 'Stock', icon: PackageIcon },
  { href: '/sales', label: 'Sales', icon: CoinsIcon },
  { href: '/expenses', label: 'Expenses', icon: ReceiptIcon },
  { href: '/categories', label: 'Categories', icon: TagIcon },
  { href: '/attendants', label: 'Attendants', icon: UsersThreeIcon },
];

const ATTENDANT_NAV: NavItem[] = [
  { href: '/shop', label: 'Stock', icon: StorefrontIcon },
  { href: '/shop/sale', label: 'Sell', icon: CoinsIcon },
  { href: '/shop/expense', label: 'Expense', icon: ReceiptIcon },
  { href: '/shop/summary', label: 'Summary', icon: ChartBarIcon },
];

/**
 * One line on desktop. On phones the row scrolls horizontally rather than
 * collapsing into a "More" menu: six destinations is too few to justify
 * hiding half of them behind an extra tap in a shop.
 */
export function AppNav({ variant }: { variant: 'owner' | 'attendant' }) {
  const pathname = usePathname();
  const items = variant === 'owner' ? OWNER_NAV : ATTENDANT_NAV;

  return (
    <nav
      aria-label="Main"
      className="-mx-4 overflow-x-auto px-4 pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex w-max gap-1 sm:w-auto">
        {items.map(({ href, label, icon: IconGlyph }) => {
          /*
           * /shop is a prefix of /shop/sale, so a plain startsWith would light
           * up "Stock" on every attendant screen. Only the exact path counts
           * for it; deeper sections still match their own subtrees.
           */
          const active =
            pathname === href ||
            (href !== '/shop' && href !== '/dashboard' && pathname.startsWith(`${href}/`));

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-2 text-[0.875rem] font-medium transition-colors"
                style={
                  active
                    ? {
                        background: 'var(--accent-soft)',
                        color: 'var(--accent-text)',
                      }
                    : { color: 'var(--text-muted)' }
                }
              >
                <IconGlyph size={17} weight={active ? 'fill' : 'regular'} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

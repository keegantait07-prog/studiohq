// The navigation map: which screens live in which rail section. Pure data, so it can be tested.
export type ViewId = 'dashboard' | 'vault' | 'loops' | 'map' | 'crm' | 'leads' | 'sales' | 'store' | 'content' | 'sounds' | 'kits' | 'plugins' | 'feedback' | 'themes'
export type SectionId = 'home' | 'make' | 'sell' | 'reach' | 'studio'

export interface NavSection { id: SectionId; label: string; /** an existing Icon name, so every theme restyles it */ icon: string; tabs: { view: ViewId; label: string }[] }

export const SECTIONS: NavSection[] = [
  { id: 'home', label: 'Home', icon: 'dashboard', tabs: [{ view: 'dashboard', label: 'Dashboard' }] },
  { id: 'make', label: 'Make', icon: 'vault', tabs: [{ view: 'vault', label: 'Beats' }, { view: 'loops', label: 'Loops' }, { view: 'sounds', label: 'Sounds' }, { view: 'kits', label: 'Kits' }, { view: 'map', label: 'Map' }] },
  { id: 'sell', label: 'Sell', icon: 'sales', tabs: [{ view: 'store', label: 'Store' }, { view: 'sales', label: 'Sales' }] },
  { id: 'reach', label: 'Reach', icon: 'crm', tabs: [{ view: 'crm', label: 'Pitch CRM' }, { view: 'leads', label: 'Leads' }, { view: 'content', label: 'Content' }, { view: 'feedback', label: 'Feedback' }] },
  { id: 'studio', label: 'Studio', icon: 'plugins', tabs: [{ view: 'plugins', label: 'Plugins' }, { view: 'themes', label: 'Themes' }] }
]

export const ALL_VIEWS: ViewId[] = ['dashboard', 'vault', 'loops', 'map', 'crm', 'leads', 'sales', 'store', 'content', 'sounds', 'kits', 'plugins', 'feedback', 'themes']

export function sectionOf(view: ViewId): NavSection {
  return SECTIONS.find((s) => s.tabs.some((t) => t.view === view)) ?? SECTIONS[0]
}

/** Where a click on a rail section goes: the screen you are on if it is in that section, else the tab you last used there, else its first tab. */
export function sectionTarget(section: NavSection, last: Partial<Record<SectionId, ViewId>>, current: ViewId): ViewId {
  if (section.tabs.some((t) => t.view === current)) return current
  const remembered = last[section.id]
  return remembered && section.tabs.some((t) => t.view === remembered) ? remembered : section.tabs[0].view
}

/** True when any tab in the section has something that needs a look (a badge). */
export function hasDot(section: NavSection, badges: Partial<Record<ViewId, boolean>>): boolean {
  return section.tabs.some((t) => badges[t.view])
}
